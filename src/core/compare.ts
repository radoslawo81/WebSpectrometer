// Spectrum comparison (web-only feature, not in the original Theremino program).
//
// Workflow: save a reference spectrum, switch to the second source, save & compare.
// For the whole spectrum and for each band (UV, B, G, R, IR) we integrate the intensity
// over wavelength (trapezoids, nm) and report the relative change of the second spectrum
// against the reference. A shape difference (independent of overall brightness) is also given:
// both spectra are normalised to unit area and the total-variation distance
// ½·∫|a(λ) − b(λ)| dλ is reported in percent (0 % = identical shape, 100 % = no overlap).

export interface SpectrumSnapshot {
  nmMin: number // wavelength of sample 0
  nmMax: number // nm = nmMin + (nmMax − nmMin)·i/n (same convention as the pipeline)
  values: number[]
  time: number // Date.now()
}

export interface Band {
  key: 'UV' | 'B' | 'G' | 'R' | 'IR'
  lo: number // nm, inclusive
  hi: number // nm, exclusive
}

// Conventional limits; UV/IR are open-ended and clipped to the measured range
export const BANDS: Band[] = [
  { key: 'UV', lo: -Infinity, hi: 400 },
  { key: 'B', lo: 400, hi: 500 },
  { key: 'G', lo: 500, hi: 600 },
  { key: 'R', lo: 600, hi: 700 },
  { key: 'IR', lo: 700, hi: Infinity },
]

export interface BandResult {
  key: string
  lo: number // covered range actually integrated (nm); NaN when the band is outside the data
  hi: number
  ref: number // integrated intensity (value·nm)
  cur: number
  diffPct: number | null // (cur − ref)/ref·100; null when the reference has no signal there
  refShare: number // share of the band in the total, %
  curShare: number
}

export interface CompareResult {
  total: BandResult
  bands: BandResult[]
  shapeDiffPct: number | null
  overlap: [number, number] // common wavelength range used for the comparison
}

export function snapshotSpectrum(values: ArrayLike<number>, nmMin: number, nmMax: number): SpectrumSnapshot {
  const out = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) out[i] = Math.max(0, values[i])
  return { nmMin, nmMax, values: out, time: Date.now() }
}

export function isCalibrated(s: SpectrumSnapshot): boolean {
  return s.values.length > 1 && s.nmMax > s.nmMin
}

function nmAt(s: SpectrumSnapshot, i: number): number {
  return s.nmMin + ((s.nmMax - s.nmMin) * i) / s.values.length
}

// Linear interpolation of a snapshot at wavelength nm (0 outside the data)
function valueAt(s: SpectrumSnapshot, nm: number): number {
  const n = s.values.length
  const f = ((nm - s.nmMin) * n) / (s.nmMax - s.nmMin)
  if (f < 0 || f > n - 1) return 0
  const i = Math.floor(f)
  const t = f - i
  return i + 1 < n ? s.values[i] * (1 - t) + s.values[i + 1] * t : s.values[i]
}

// Trapezoidal integral of y(x) between lo and hi on the sorted grid xs (partial edge intervals interpolated)
function integrate(xs: number[], ys: number[], lo: number, hi: number): number {
  let sum = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = Math.max(xs[i], lo)
    const b = Math.min(xs[i + 1], hi)
    if (b <= a) continue
    const dx = xs[i + 1] - xs[i]
    const ya = ys[i] + ((ys[i + 1] - ys[i]) * (a - xs[i])) / dx
    const yb = ys[i] + ((ys[i + 1] - ys[i]) * (b - xs[i])) / dx
    sum += ((ya + yb) / 2) * (b - a)
  }
  return sum
}

export function compareSpectra(ref: SpectrumSnapshot, cur: SpectrumSnapshot): CompareResult {
  // Common wavelength range; work on the reference grid (the current spectrum is resampled if
  // its calibration differs)
  const lo = Math.max(ref.nmMin, cur.nmMin)
  const hi = Math.min(nmAt(ref, ref.values.length - 1), nmAt(cur, cur.values.length - 1))
  const xs: number[] = []
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < ref.values.length; i++) {
    const x = nmAt(ref, i)
    if (x < lo || x > hi) continue
    xs.push(x)
    a.push(ref.values[i])
    b.push(valueAt(cur, x))
  }

  const band = (key: string, bl: number, bh: number, totalRef: number, totalCur: number): BandResult => {
    const l = Math.max(bl, lo)
    const h = Math.min(bh, hi)
    if (!(h > l) || xs.length < 2) {
      return { key, lo: NaN, hi: NaN, ref: 0, cur: 0, diffPct: null, refShare: 0, curShare: 0 }
    }
    const r = integrate(xs, a, l, h)
    const c = integrate(xs, b, l, h)
    return {
      key,
      lo: l,
      hi: h,
      ref: r,
      cur: c,
      diffPct: r > 0 ? ((c - r) / r) * 100 : null,
      refShare: totalRef > 0 ? (r / totalRef) * 100 : 0,
      curShare: totalCur > 0 ? (c / totalCur) * 100 : 0,
    }
  }

  const tRef = xs.length > 1 ? integrate(xs, a, lo, hi) : 0
  const tCur = xs.length > 1 ? integrate(xs, b, lo, hi) : 0
  const total = band('Total', lo, hi, tRef, tCur)
  const bands = BANDS.map((bd) => band(bd.key, bd.lo, bd.hi, tRef, tCur))

  let shapeDiffPct: number | null = null
  if (tRef > 0 && tCur > 0) {
    const d = a.map((v, i) => Math.abs(v / tRef - b[i] / tCur))
    // ½·∫|a−b|dλ on unit-area spectra, in percent
    shapeDiffPct = Math.min(100, 50 * integrate(xs, d, lo, hi))
  }
  return { total, bands, shapeDiffPct, overlap: [lo, hi] }
}
