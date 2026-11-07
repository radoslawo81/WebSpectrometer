// Automatic wavelength calibration from a reference lamp (web-only feature).
//
// 1. Find peaks (emission) or dips (absorption, sunlight) in the displayed spectrum, with
//    parabolic sub-sample centres on the CURRENT nm axis (whatever the calibration is now).
// 2. Search linear maps true = a + b·x (from pairs of strong peaks × pairs of reference lines)
//    maximising the matched, intensity-weighted reference lines.
// 3. Refine with a weighted polynomial (degree ≤ 3) and shrinking tolerance; drop outliers.
// 4. Convert matched peak positions back to sensor bins through the current calibration and
//    propose calibration points (piecewise-linear model of the program) with residuals.

import { type Calibration, interpolate, nmToBin } from './calibration'
import { linesOf, type CalSource, type RefLine } from './lines'

export interface FoundPeak {
  x: number // centre on the current nm axis
  height: number
  prominence: number
  index: number // sample index of the maximum (for saturation lookup)
}

export interface AutoCalMatch {
  line: RefLine
  peak: FoundPeak
  bin: number // sensor bin (calibration units = samples)
  fitNm: number // polynomial fit at this peak
  residual: number // fitNm − line.nm
  use: boolean // proposed as a calibration point
  saturated?: boolean
}

export interface AutoCalResult {
  ok: boolean
  message?: 'flipped' | 'few' | 'nopeaks'
  matches: AutoCalMatch[]
  rms: number // nm, of used points against the polynomial fit
  dispersion: number // nm per sensor sample (median)
  rangeNm: [number, number] // full sensor range with the new calibration
  calibration: Calibration | null
}

function findPeaks(v: ArrayLike<number>, nmMin: number, nmMax: number, absorption: boolean): FoundPeak[] {
  const n = v.length
  const step = (nmMax - nmMin) / n
  const sig = new Float64Array(n)
  let mx = 0
  for (let i = 0; i < n; i++) if (v[i] > mx) mx = v[i]
  if (!(mx > 0)) return []
  if (absorption) {
    // Dips relative to a local upper envelope (running max over ±12 nm)
    const half = Math.max(3, Math.round(12 / Math.abs(step)))
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (v[j] > m) m = v[j]
      sig[i] = m - v[i]
    }
  } else {
    for (let i = 0; i < n; i++) sig[i] = v[i]
  }
  const minProm = (absorption ? 0.012 : 0.015) * mx
  const peaks: FoundPeak[] = []
  for (let i = 2; i < n - 2; i++) {
    if (!(sig[i] >= sig[i - 1] && sig[i] > sig[i + 1])) continue
    let l = sig[i]
    for (let j = i; j >= 0 && sig[j] <= sig[i]; j--) if (sig[j] < l) l = sig[j]
    let r = sig[i]
    for (let j = i; j < n && sig[j] <= sig[i]; j++) if (sig[j] < r) r = sig[j]
    const prom = sig[i] - Math.max(l, r)
    if (prom < minProm) continue
    if (absorption && v[i] < 0.05 * mx) continue // ignore the dark ends
    const a = sig[i - 1]
    const b = sig[i]
    const c = sig[i + 1]
    const den = a - 2 * b + c
    let d = den !== 0 ? (0.5 * (a - c)) / den : 0
    if (d > 0.5) d = 0.5
    if (d < -0.5) d = -0.5
    peaks.push({ x: nmMin + step * (i + d), height: v[i], prominence: prom, index: i })
  }
  return peaks.sort((p, q) => q.prominence - p.prominence)
}

// Weighted least squares polynomial (degree d) through (x, y, w); returns coefficients c0..cd
function polyfit(x: number[], y: number[], w: number[], d: number): number[] {
  const m = d + 1
  const A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0))
  // Centre/scale x for conditioning
  for (let k = 0; k < x.length; k++) {
    const pw: number[] = [1]
    for (let j = 1; j < 2 * m; j++) pw.push(pw[j - 1] * x[k])
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += w[k] * pw[r + c]
      A[r][m] += w[k] * pw[r] * y[k]
    }
  }
  for (let col = 0; col < m; col++) {
    let piv = col
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    const p = A[col][col]
    if (Math.abs(p) < 1e-300) return new Array(m).fill(NaN)
    for (let c = col; c <= m; c++) A[col][c] /= p
    for (let r = 0; r < m; r++) {
      if (r === col) continue
      const f = A[r][col]
      for (let c = col; c <= m; c++) A[r][c] -= f * A[col][c]
    }
  }
  return A.map((row) => row[m])
}

const polyval = (c: number[], x: number) => c.reduce((s, ci, i) => s + ci * Math.pow(x, i), 0)

export function autoCalibrate(
  values: ArrayLike<number>,
  nmMin: number,
  nmMax: number,
  current: Calibration,
  numSamples: number,
  source: CalSource,
  saturated?: ArrayLike<number> | null,
): AutoCalResult {
  const empty: AutoCalResult = { ok: false, matches: [], rms: NaN, dispersion: NaN, rangeNm: [NaN, NaN], calibration: null }
  const absorption = source.kind === 'absorption'
  const peaks = findPeaks(values, nmMin, nmMax, absorption).slice(0, 40)
  if (peaks.length < 3) return { ...empty, message: 'nopeaks' }
  const lines = linesOf(source.sets)
    .filter((l) => l.kind === source.kind && l.strength >= 2)
    .sort((p, q) => p.nm - q.nm)
  const lineNm = lines.map((l) => l.nm)
  const nearest = (t: number) => {
    let lo = 0
    let hi = lineNm.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (lineNm[mid] < t) lo = mid
      else hi = mid
    }
    return Math.abs(lineNm[lo] - t) <= Math.abs(lineNm[hi] - t) ? lo : hi
  }

  // Coarse search over linear maps
  const strong = peaks.slice(0, 14)
  const candLines = lines.filter((l) => l.strength >= 3)
  const scorePeaks = peaks.slice(0, 30)
  let best = { score: 0, a: 0, b: 1 }
  for (let i = 0; i < strong.length; i++) {
    for (let j = i + 1; j < strong.length; j++) {
      const x1 = strong[i].x
      const x2 = strong[j].x
      if (Math.abs(x2 - x1) < 1e-6) continue
      for (const l1 of candLines) {
        for (const l2 of candLines) {
          if (l1 === l2) continue
          const b = (l2.nm - l1.nm) / (x2 - x1)
          const ab = Math.abs(b)
          if (ab < 0.25 || ab > 4) continue
          const a = l1.nm - b * x1
          let score = 0
          const used = new Set<number>()
          for (const p of scorePeaks) {
            const t = a + b * p.x
            const k = nearest(t)
            const L = lines[k]
            const tol = 1.5 + (L.approx ? 1 : 0)
            const dev = Math.abs(L.nm - t)
            if (dev <= tol && !used.has(k)) {
              used.add(k)
              // closer matches count more; every matched line adds a constant so that many
              // consistent lines beat a few strong coincidences
              score += (1 - dev / (tol * 2)) * (1 + Math.sqrt(p.prominence / strong[0].prominence) * Math.sqrt(L.strength))
            }
          }
          if (score > best.score) best = { score, a, b }
        }
      }
    }
  }
  if (best.score === 0) return { ...empty, message: 'few' }
  if (best.b < 0) return { ...empty, message: 'flipped' }

  // Refinement: polynomial fit with shrinking tolerance
  let coef = [best.a, best.b]
  let pairs: { p: FoundPeak; k: number }[] = []
  // Linear steps first (robust), then curvature only when enough lines support it
  const steps: [number, number][] = [
    [2.0, 1],
    [1.5, 1],
    [1.2, 2],
    [1.0, 3],
  ]
  for (const [tol, maxDeg] of steps) {
    const byLine = new Map<number, FoundPeak>()
    for (const p of peaks) {
      const t = polyval(coef, p.x)
      const k = nearest(t)
      const L = lines[k]
      if (Math.abs(L.nm - t) > tol + (L.approx ? 1 : 0)) continue
      const prev = byLine.get(k)
      if (!prev || prev.prominence < p.prominence) byLine.set(k, p)
    }
    pairs = [...byLine.entries()].map(([k, p]) => ({ p, k }))
    if (pairs.length < 3) break
    const deg = Math.min(maxDeg, pairs.length >= 10 ? 3 : pairs.length >= 6 ? 2 : 1)
    const xs = pairs.map((q) => q.p.x)
    const xm = xs.reduce((s, x) => s + x, 0) / xs.length
    const c = polyfit(
      xs.map((x) => x - xm),
      pairs.map((q) => lines[q.k].nm),
      pairs.map((q) => (lines[q.k].approx ? 0.2 : 1) * Math.sqrt(q.p.prominence)),
      deg,
    )
    if (c.some((v) => !Number.isFinite(v))) break
    // Re-express around 0 for polyval(x)
    coef = expandShift(c, xm)
  }
  if (pairs.length < 3) return { ...empty, message: 'few' }

  // Build matches with bins through the current calibration
  const matches: AutoCalMatch[] = pairs
    .map(({ p, k }) => {
      const fitNm = polyval(coef, p.x)
      return {
        line: lines[k],
        peak: p,
        bin: nmToBin(current, p.x),
        fitNm,
        residual: fitNm - lines[k].nm,
        use: false,
        saturated: saturated ? saturated[p.index] > 0 : false,
      }
    })
    .sort((m1, m2) => m1.line.nm - m2.line.nm)

  // Outliers: > max(0.8 nm, 3·MAD) from the fit
  const absr = matches.map((m) => Math.abs(m.residual)).sort((x, y) => x - y)
  const mad = absr[Math.floor(absr.length / 2)] || 0.1
  const lim = Math.max(0.8, 3 * mad)
  // Proposed calibration points: calibration-grade lines within limits, ≥ ~25 nm apart (strongest wins)
  const cand = matches
    .filter((m) => m.line.cal && Math.abs(m.residual) <= lim)
    .sort((m1, m2) => m2.peak.prominence * (m2.line.approx ? 0.3 : 1) - m1.peak.prominence * (m1.line.approx ? 0.3 : 1))
  const chosen: AutoCalMatch[] = []
  for (const m of cand) {
    if (chosen.every((c) => Math.abs(c.line.nm - m.line.nm) >= 25)) chosen.push(m)
  }
  chosen.forEach((m) => (m.use = true))
  return finalize(matches, numSamples)
}

// Recompute calibration, dispersion and residuals from the matches marked `use`
export function finalize(matches: AutoCalMatch[], numSamples: number): AutoCalResult {
  const used = matches.filter((m) => m.use).sort((m1, m2) => m1.bin - m2.bin)
  if (used.length < 2) {
    return { ok: false, message: 'few', matches, rms: NaN, dispersion: NaN, rangeNm: [NaN, NaN], calibration: null }
  }
  // Monotonic check (bins and nm must both increase)
  for (let i = 1; i < used.length; i++) {
    if (!(used[i].bin > used[i - 1].bin && used[i].line.nm > used[i - 1].line.nm)) {
      return { ok: false, message: 'few', matches, rms: NaN, dispersion: NaN, rangeNm: [NaN, NaN], calibration: null }
    }
  }
  const calibration: Calibration = { bins: used.map((m) => m.bin), nms: used.map((m) => m.line.nm) }
  const rms = Math.sqrt(used.reduce((s, m) => s + m.residual * m.residual, 0) / used.length)
  const slopes: number[] = []
  for (let i = 1; i < used.length; i++) slopes.push((used[i].line.nm - used[i - 1].line.nm) / (used[i].bin - used[i - 1].bin))
  slopes.sort((x, y) => x - y)
  const dispersion = slopes[Math.floor(slopes.length / 2)]
  const rangeNm: [number, number] = [
    interpolate(calibration.bins, calibration.nms, 0),
    interpolate(calibration.bins, calibration.nms, numSamples),
  ]
  return { ok: true, matches, rms, dispersion, rangeNm, calibration }
}

// Predicted wavelength of a match under a calibration (for the residual column after applying)
export function predictedNm(cal: Calibration, m: AutoCalMatch): number {
  return interpolate(cal.bins, cal.nms, m.bin)
}

// Coefficients of p(x − xm) re-expressed as a polynomial in x
function expandShift(c: number[], xm: number): number[] {
  const out = new Array<number>(c.length).fill(0)
  for (let i = 0; i < c.length; i++) {
    // c_i (x − xm)^i = c_i Σ_k C(i,k) x^k (−xm)^(i−k)
    for (let k = 0; k <= i; k++) out[k] += c[i] * binom(i, k) * Math.pow(-xm, i - k)
  }
  return out
}

function binom(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
