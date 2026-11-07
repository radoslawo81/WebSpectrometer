// Spectral response calibration from a halogen / incandescent lamp (web-only feature).
//
// A halogen lamp at full voltage radiates close to a black body at its colour temperature
// (≈2800–3200 K). Measuring it gives camera·grating·lamp; dividing Planck(T) by the (smoothed)
// measurement gives the relative response correction of the spectrometer:
//   corr(λ) = Planck(λ, T) / measured(λ)      (normalised to 1 at 560 nm or the nearest valid point)
// Where the measured signal is too weak (< threshold of its maximum) the correction is unreliable
// and is left undefined (NaN); those wavelengths are reported as "not measured".

import { planck } from './colorimetry'

export interface ResponseCalibration {
  nms: number[] // 1 nm grid
  coeffs: number[] // NaN where invalid
  validLo: number
  validHi: number
  lampT: number
  time: number
}

const SMOOTH_NM = 4 // boxcar width on the halogen measurement: suppresses noise but keeps sharp camera features (IR-cut edges)
const MIN_SIGNAL = 0.05 // ignore wavelengths below 5 % of the maximum signal

export function calibrateResponse(
  values: ArrayLike<number>,
  nmMin: number,
  nmMax: number,
  lampT: number,
): ResponseCalibration | string {
  const n = values.length
  if (!(nmMax > nmMin) || n < 10) return 'Spectrum not calibrated in wavelength'
  const step = (nmMax - nmMin) / n
  const at = (nm: number) => {
    // boxcar average of the measurement around nm
    const i0 = Math.max(0, Math.ceil((nm - SMOOTH_NM / 2 - nmMin) / step))
    const i1 = Math.min(n - 1, Math.floor((nm + SMOOTH_NM / 2 - nmMin) / step))
    let acc = 0
    let cnt = 0
    for (let i = i0; i <= i1; i++) {
      acc += Math.max(0, values[i])
      cnt++
    }
    return cnt ? acc / cnt : NaN
  }
  const lo = Math.ceil(nmMin + SMOOTH_NM / 2)
  const hi = Math.floor(nmMin + step * (n - 1) - SMOOTH_NM / 2)
  const nms: number[] = []
  const meas: number[] = []
  for (let nm = lo; nm <= hi; nm++) {
    nms.push(nm)
    meas.push(at(nm))
  }
  const mMax = Math.max(...meas.filter(Number.isFinite))
  if (!(mMax > 0)) return 'No signal'
  const raw = nms.map((nm, i) => (meas[i] >= MIN_SIGNAL * mMax ? planck(nm, lampT) / meas[i] : NaN))
  // Keep only the contiguous valid range around the signal maximum
  const iMax = meas.indexOf(mMax)
  let a = iMax
  let b = iMax
  while (a > 0 && Number.isFinite(raw[a - 1])) a--
  while (b < raw.length - 1 && Number.isFinite(raw[b + 1])) b++
  const coeffs = raw.map((c, i) => (i >= a && i <= b ? c : NaN))
  // Normalise to 1 at 560 nm (or nearest valid wavelength)
  let iRef = nms.indexOf(560)
  if (iRef < a || iRef > b || iRef < 0) iRef = iMax
  const k = coeffs[iRef]
  return {
    nms,
    coeffs: coeffs.map((c) => (Number.isFinite(c) ? c / k : NaN)),
    validLo: nms[a],
    validHi: nms[b],
    lampT,
    time: Date.now(),
  }
}

export function responseAt(cal: ResponseCalibration, nm: number): number {
  if (nm < cal.validLo || nm > cal.validHi) return NaN
  const i = Math.floor(nm - cal.nms[0])
  const t = nm - cal.nms[0] - i
  const c0 = cal.coeffs[i]
  const c1 = cal.coeffs[Math.min(i + 1, cal.coeffs.length - 1)]
  return Number.isFinite(c1) ? c0 * (1 - t) + c1 * t : c0
}

// Apply the correction to a spectrum on the pipeline's linear nm grid (NaN outside the valid range)
export function applyResponse(values: ArrayLike<number>, nmMin: number, nmMax: number, cal: ResponseCalibration): number[] {
  const n = values.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const nm = nmMin + ((nmMax - nmMin) * i) / n
    out[i] = values[i] * responseAt(cal, nm)
  }
  return out
}

// Text file: "nm<TAB>coeff" lines (same layout as Theremino irradiance coefficient files) + header comments
export function responseToText(cal: ResponseCalibration): string {
  const lines = [
    `# Spectral response correction (WebSpectrometer fork), halogen ${cal.lampT} K, ${new Date(cal.time).toISOString()}`,
    `# valid ${cal.validLo}-${cal.validHi} nm; multiply the measured spectrum by coeff`,
  ]
  cal.nms.forEach((nm, i) => {
    if (Number.isFinite(cal.coeffs[i])) lines.push(`${nm}\t${cal.coeffs[i].toPrecision(6)}`)
  })
  return lines.join('\n') + '\n'
}

export function responseFromText(text: string): ResponseCalibration | string {
  const nms: number[] = []
  const coeffs: number[] = []
  let lampT = NaN
  let time = Date.now()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      const m = line.match(/halogen\s+([\d.]+)\s*K,\s*(\S+)/)
      if (m) {
        lampT = Number.parseFloat(m[1])
        const d = Date.parse(m[2])
        if (Number.isFinite(d)) time = d
      }
      continue
    }
    const parts = line.split(/[\s\t;,]+/)
    if (parts.length < 2) continue
    const nm = Number.parseFloat(parts[0])
    const c = Number.parseFloat(parts[1])
    if (!Number.isFinite(nm) || !Number.isFinite(c) || c <= 0) continue
    nms.push(nm)
    coeffs.push(c)
  }
  if (nms.length < 2) return 'No valid "nm coeff" lines'
  // Resample to the 1 nm grid
  const lo = Math.ceil(nms[0])
  const hi = Math.floor(nms[nms.length - 1])
  const g: number[] = []
  const cg: number[] = []
  let j = 0
  for (let nm = lo; nm <= hi; nm++) {
    while (j < nms.length - 2 && nms[j + 1] < nm) j++
    const t = (nm - nms[j]) / (nms[j + 1] - nms[j])
    g.push(nm)
    cg.push(coeffs[j] * (1 - t) + coeffs[j + 1] * t)
  }
  return { nms: g, coeffs: cg, validLo: lo, validHi: hi, lampT, time }
}
