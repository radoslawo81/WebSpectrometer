// Per-channel correction of the AS7265x factory calibration (web-only).
// Measured once with an incandescent lamp of known colour temperature T: for every channel
// f_i = Planck(λ_i, T) / reading_i, normalised so the median factor is 1 (keeps the µW/cm² level).
import { planck } from './colorimetry'

export interface TriadCorrection {
  T: number // K, colour temperature of the reference lamp
  date: string // ISO time of the calibration
  f: number[] // 18 factors in wavelength order; 1 for channels that could not be calibrated
  bad: number[] // channel indices that read 0 / invalid during the calibration
}

export function parseTriadCorr(s: string): TriadCorrection | null {
  if (!s) return null
  try {
    const c = JSON.parse(s) as TriadCorrection
    if (!Array.isArray(c.f) || c.f.length !== 18 || c.f.some((x) => !Number.isFinite(x) || x <= 0)) return null
    return { T: c.T, date: c.date, f: c.f, bad: Array.isArray(c.bad) ? c.bad : [] }
  } catch {
    return null
  }
}

/** Correction from the mean factory reading (18 values, µW/cm²) of a lamp with colour temperature T */
export function computeTriadCorr(nm: number[], factory: number[], T: number): TriadCorrection | string {
  if (!(T >= 1500 && T <= 4000)) return 'Tri_CorrErrT'
  const ref = nm.map((w) => planck(w, T))
  const raw = factory.map((m, i) => (m > 0 ? ref[i] / m : NaN))
  const good = raw.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (good.length < 12) return 'Tri_CorrErrSignal'
  const med = good[Math.floor(good.length / 2)]
  const bad: number[] = []
  const f = raw.map((x, i) => {
    if (!Number.isFinite(x)) {
      bad.push(i)
      return 1
    }
    return x / med
  })
  return { T, date: new Date().toISOString(), f, bad }
}

export function applyTriadCorr(values: number[], c: TriadCorrection | null): number[] {
  return c ? values.map((v, i) => v * (c.f[i] ?? 1)) : values
}
