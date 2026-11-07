// Peak identification against the reference line list and second-order helpers (web-only)
import { identify, type LineMatch, type LineSet } from './lines'

export interface IdentifiedPeak {
  nm: number
  value: number
  prominence: number
  dip: boolean
  match: LineMatch | null
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
    out.push({ nm: nmMin + step * (i + d), value: v[i], prominence: prom, dip, match: null })
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
    const m = identify(p.nm, sets, 1.5, secondOrder).filter((x) => (p.dip ? x.line.kind === 'absorption' : x.line.kind === 'emission'))
    p.match = m[0] ?? null
  }
  return peaks.sort((p, q) => p.nm - q.nm)
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
