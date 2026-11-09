// Peak identification against the reference line list and second-order helpers (web-only)
import { identify, type LineMatch, type LineSet } from './lines'

export interface IdentifiedPeak {
  nm: number
  value: number
  prominence: number
  dip: boolean
  match: LineMatch | null
  idx: number // sample index of the maximum
  fwhmNm: number // approximate full width at half maximum (nm), NaN if not measurable
  ghost?: GhostInfo // the peak is (probably) a higher diffraction order of a shorter-wavelength peak
}

export type GhostOrder = 2 | 3

const BROAD_NM = 8 // emission peaks wider than this are LEDs / phosphor bands, not atomic lines

export interface GhostInfo {
  order: GhostOrder
  parentNm: number // measured wavelength of the first-order peak
  parentMatch: LineMatch | null // identification of the first-order peak, if any
}

function centres(v: ArrayLike<number>, nmMin: number, step: number, sig: Float64Array, minProm: number, dip: boolean): IdentifiedPeak[] {
  const n = sig.length
  const out: IdentifiedPeak[] = []
  for (let i = 2; i < n - 2; i++) {
    if (!(sig[i] >= sig[i - 1] && sig[i] > sig[i + 1])) continue
    let l = sig[i]
    for (let j = i; j >= 0 && sig[j] <= sig[i]; j--) if (sig[j] < l) l = sig[j]
    let r = sig[i]
    for (let j = i; j < n && sig[j] <= sig[i]; j++) if (sig[j] < r) r = sig[j]
    const prom = sig[i] - Math.max(l, r)
    if (prom < minProm) continue
    const a = sig[i - 1]
    const b = sig[i]
    const c = sig[i + 1]
    const den = a - 2 * b + c
    let d = den !== 0 ? (0.5 * (a - c)) / den : 0
    d = Math.max(-0.5, Math.min(0.5, d))
    out.push({ nm: nmMin + step * (i + d), value: v[i], prominence: prom, dip, match: null, idx: i, fwhmNm: NaN })
  }
  return out
}

export function identifyPeaks(
  v: ArrayLike<number>,
  nmMin: number,
  nmMax: number,
  sets: LineSet[],
  secondOrder: boolean,
  maxN = 15,
  ghostOrders: GhostOrder[] = [],
): IdentifiedPeak[] {
  const n = v.length
  if (n < 10 || !(nmMax > nmMin)) return []
  const step = (nmMax - nmMin) / n
  let mx = 0
  for (let i = 0; i < n; i++) if (v[i] > mx) mx = v[i]
  if (!(mx > 0)) return []
  const sig = new Float64Array(n)
  for (let i = 0; i < n; i++) sig[i] = v[i]
  let peaks = centres(v, nmMin, step, sig, 0.02 * mx, false)
  if (sets.includes('Sun')) {
    const half = Math.max(3, Math.round(12 / step))
    const dipSig = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let m = 0
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (v[j] > m) m = v[j]
      dipSig[i] = v[i] > 0.05 * mx ? m - v[i] : 0
    }
    peaks = peaks.concat(centres(v, nmMin, step, dipSig, 0.012 * mx, true))
  }
  peaks.sort((p, q) => q.prominence - p.prominence)
  peaks = peaks.slice(0, maxN)
  for (const p of peaks) {
    if (!p.dip) p.fwhmNm = halfWidth(v, p.idx) * step
    // A broad emission peak (> 8 nm, e.g. an LED) cannot be an atomic line: only phosphor bands (approx) may match it
    const broad = !p.dip && p.fwhmNm > BROAD_NM
    const m = identify(p.nm, sets, 1.5, secondOrder).filter(
      (x) => (p.dip ? x.line.kind === 'absorption' : x.line.kind === 'emission') && (!broad || x.line.approx),
    )
    p.match = m[0] ?? null
  }
  if (ghostOrders.length) markGhosts(peaks, ghostOrders)
  return peaks.sort((p, q) => p.nm - q.nm)
}

// Full width at half maximum of the peak at index i, in samples (linear interpolation at the edges).
// A saturated (flat-topped) peak gives a too wide value, which only makes the ghost tolerance looser.
function halfWidth(v: ArrayLike<number>, i: number): number {
  const half = v[i] / 2
  let l = i
  while (l > 0 && v[l] > half) l--
  let r = i
  while (r < v.length - 1 && v[r] > half) r++
  if (v[l] > half || v[r] > half) return NaN
  const fl = v[l + 1] !== v[l] ? (v[l + 1] - half) / (v[l + 1] - v[l]) : 0
  const fr = v[r - 1] !== v[r] ? (v[r - 1] - half) / (v[r - 1] - v[r]) : 0
  return r - fr - (l + fl)
}

// Higher diffraction orders: a grating also sends light of wavelength λ to 2λ and 3λ. A peak at k·λ
// of a shorter-wavelength peak is flagged as its k-th order "ghost" instead of being identified as a
// line (e.g. a 365 nm UV LED shows up again at ~730–740 and ~1100 nm). The tolerance grows with the
// order and with the width of the first-order peak, because broad LED peaks shift when weighted by the
// sensor response. A ghost brighter than twice its parent is not accepted.
export function markGhosts(peaks: IdentifiedPeak[], orders: GhostOrder[]): void {
  const emissions = peaks.filter((p) => !p.dip)
  for (const p of emissions) {
    let best: { info: GhostInfo; score: number } | null = null
    for (const k of [...orders].sort()) {
      for (const q of emissions) {
        if (q === p || q.nm * k > p.nm + 50 || q.nm >= p.nm) continue
        const w = Number.isFinite(q.fwhmNm) ? q.fwhmNm : 4
        const tol = k * Math.max(2, 0.6 * w)
        const d = Math.abs(p.nm - k * q.nm)
        if (d > tol || p.value > 2 * q.value) continue
        // A narrow peak that matches a reference line better than the k·λ prediction stays that line
        // (e.g. Ar 727.3 nm next to 2 × Hg 365 nm in a germicidal lamp). Broad peaks (> 8 nm) cannot be
        // atomic lines, so for them the ghost wins (UV LED at 2 × 365 nm vs Ar 738.4 nm).
        const narrow = !Number.isFinite(p.fwhmNm) || p.fwhmNm <= BROAD_NM
        if (p.match && narrow && Math.abs(p.match.delta) <= d) continue
        const score = d / tol + (k - 2) * 0.25 // prefer the lower order when both fit
        if (!best || score < best.score) best = { info: { order: k, parentNm: q.nm, parentMatch: q.match }, score }
      }
    }
    if (best) {
      p.ghost = best.info
      p.match = null
    }
  }
}

// Wavelength above which second-order light can be present: twice the shortest wavelength that
// carries signal (> 3 % of the maximum). Null if beyond the axis.
export function secondOrderStart(v: ArrayLike<number>, nmMin: number, nmMax: number): number | null {
  const n = v.length
  if (n < 10 || !(nmMax > nmMin)) return null
  let mx = 0
  for (let i = 0; i < n; i++) if (v[i] > mx) mx = v[i]
  if (!(mx > 0)) return null
  const step = (nmMax - nmMin) / n
  for (let i = 0; i < n; i++) {
    if (v[i] > 0.03 * mx) {
      const s = 2 * (nmMin + step * i)
      return s < nmMax ? s : null
    }
  }
  return null
}
