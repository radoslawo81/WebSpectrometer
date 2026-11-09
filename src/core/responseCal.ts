// Spectral response calibration (web-only feature).
//
// The spectrometer is pointed at a source whose spectral shape is known. Measuring it gives
// camera·grating·source; dividing the known (reference) spectrum by the smoothed measurement gives
// the relative response correction of the spectrometer:
//   corr(λ) = reference(λ) / measured(λ)      (normalised to 1 at 560 nm or the nearest valid point)
//
// Reference sources:
//  • 'planck' – a halogen / incandescent lamp at full voltage radiates close to a black body at its
//    colour temperature (incandescent ≈ 2700 K, halogen ≈ 2850–3100 K); reference = Planck(λ, T).
//  • 'file'   – a tabulated reference spectrum loaded from a text file ("nm value" lines), e.g. a
//    ground-level solar spectrum (ASTM G173, SMARTS) for a sunlight calibration. Optionally the
//    variable atmospheric O₂ / H₂O absorption bands are skipped and bridged by interpolation.
//
// Where the measured signal is too weak (< threshold of its maximum) the correction is unreliable
// and is left undefined (NaN); those wavelengths are reported as "not measured".

import { planck } from './colorimetry'

export type ResponseSource = 'planck' | 'file'

export interface ResponseCalibration {
  nms: number[] // 1 nm grid
  coeffs: number[] // NaN where invalid
  validLo: number
  validHi: number
  lampT: number // Planck source: colour temperature (K); NaN for other sources
  time: number
  source?: ResponseSource // absent in calibrations saved by older versions (= 'planck')
  refName?: string // 'file' source: name of the reference spectrum
}

// Tabulated reference spectrum (any wavelength grid, ascending)
export interface ReferenceSpectrum {
  name: string
  nms: number[]
  values: number[]
}

export type ReferenceSpec =
  | { kind: 'planck'; T: number }
  | { kind: 'file'; ref: ReferenceSpectrum; maskAtmosphere: boolean }

const SMOOTH_NM = 4 // boxcar width on the measurement (and on a tabulated reference): suppresses noise but keeps sharp camera features
const MIN_SIGNAL = 0.05 // ignore wavelengths below 5 % of the maximum signal

// Variable telluric absorption bands (nm): O₂ B, H₂O, O₂ A, H₂O. Their depth depends on air mass and
// humidity, so a solar reference never matches them exactly: skip them and interpolate across.
export const ATMOSPHERIC_BANDS: [number, number][] = [
  [684, 694],
  [714, 736],
  [757, 772],
  [808, 838],
]

// Linear interpolation in a tabulated reference (NaN outside its range)
export function referenceAt(ref: ReferenceSpectrum, nm: number): number {
  const { nms, values } = ref
  const n = nms.length
  if (n < 2 || nm < nms[0] || nm > nms[n - 1]) return NaN
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (nms[mid] <= nm) lo = mid
    else hi = mid
  }
  const t = nms[hi] === nms[lo] ? 0 : (nm - nms[lo]) / (nms[hi] - nms[lo])
  return values[lo] * (1 - t) + values[hi] * t
}

// Boxcar average of the reference over the same width as the measurement (matches resolution roughly,
// so narrow absorption lines in e.g. a solar spectrum do not imprint on the correction)
function referenceSmoothed(ref: ReferenceSpectrum, nm: number): number {
  const steps = 8
  let acc = 0
  let cnt = 0
  for (let k = 0; k <= steps; k++) {
    const v = referenceAt(ref, nm - SMOOTH_NM / 2 + (SMOOTH_NM * k) / steps)
    if (Number.isFinite(v)) {
      acc += v
      cnt++
    }
  }
  return cnt === steps + 1 ? acc / cnt : NaN
}

function inBands(nm: number, bands: [number, number][]): boolean {
  return bands.some(([a, b]) => nm >= a && nm <= b)
}

// Halogen calibration (kept for compatibility)
export function calibrateResponse(
  values: ArrayLike<number>,
  nmMin: number,
  nmMax: number,
  lampT: number,
): ResponseCalibration | string {
  return calibrateResponseWith(values, nmMin, nmMax, { kind: 'planck', T: lampT })
}

export function calibrateResponseWith(
  values: ArrayLike<number>,
  nmMin: number,
  nmMax: number,
  spec: ReferenceSpec,
): ResponseCalibration | string {
  const n = values.length
  if (!(nmMax > nmMin) || n < 10) return 'Err_Uncal'
  if (spec.kind === 'planck' && !(spec.T > 0)) return 'Lq_EnterLampT'
  if (spec.kind === 'file' && spec.ref.nms.length < 2) return 'Err_RefFile'
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
  const refAt = (nm: number) => (spec.kind === 'planck' ? planck(nm, spec.T) : referenceSmoothed(spec.ref, nm))
  const masked = (nm: number) => spec.kind === 'file' && spec.maskAtmosphere && inBands(nm, ATMOSPHERIC_BANDS)

  const lo = Math.ceil(nmMin + SMOOTH_NM / 2)
  const hi = Math.floor(nmMin + step * (n - 1) - SMOOTH_NM / 2)
  const nms: number[] = []
  const meas: number[] = []
  for (let nm = lo; nm <= hi; nm++) {
    nms.push(nm)
    meas.push(at(nm))
  }
  const mMax = Math.max(...meas.filter(Number.isFinite))
  if (!(mMax > 0)) return 'Err_NoSignal'
  const strong = meas.map((m) => m >= MIN_SIGNAL * mMax)
  const raw = nms.map((nm, i) => {
    if (!strong[i] || masked(nm)) return NaN
    const r = refAt(nm)
    return Number.isFinite(r) && r > 0 ? r / meas[i] : NaN
  })
  // Bridge masked bands (and isolated reference gaps) where the signal is strong, by linear interpolation
  for (let i = 0; i < raw.length; i++) {
    if (Number.isFinite(raw[i]) || !strong[i]) continue
    let a = i - 1
    while (a >= 0 && !Number.isFinite(raw[a]) && strong[a]) a--
    let b = i + 1
    while (b < raw.length && !Number.isFinite(raw[b]) && strong[b]) b++
    if (a < 0 || b >= raw.length || !Number.isFinite(raw[a]) || !Number.isFinite(raw[b])) continue
    if (nms[b] - nms[a] > 40) continue // do not invent the correction over long gaps
    for (let j = a + 1; j < b; j++) raw[j] = raw[a] + ((raw[b] - raw[a]) * (j - a)) / (b - a)
    i = b
  }
  // Keep only the contiguous valid range around the signal maximum
  const iMax = meas.indexOf(mMax)
  let iSeed = iMax
  if (!Number.isFinite(raw[iSeed])) {
    // maximum fell into a gap (e.g. reference not covering it): start from the nearest valid point
    let best = -1
    for (let i = 0; i < raw.length; i++) if (Number.isFinite(raw[i]) && (best < 0 || Math.abs(i - iMax) < Math.abs(best - iMax))) best = i
    if (best < 0) return spec.kind === 'file' ? 'Err_RefRange' : 'Err_NoSignal'
    iSeed = best
  }
  let a = iSeed
  let b = iSeed
  while (a > 0 && Number.isFinite(raw[a - 1])) a--
  while (b < raw.length - 1 && Number.isFinite(raw[b + 1])) b++
  if (nms[b] - nms[a] < 50) return spec.kind === 'file' ? 'Err_RefRange' : 'Err_NoSignal'
  const coeffs = raw.map((c, i) => (i >= a && i <= b ? c : NaN))
  // Normalise to 1 at 560 nm (or nearest valid wavelength)
  let iRef = nms.indexOf(560)
  if (iRef < a || iRef > b || iRef < 0) iRef = iSeed
  const k = coeffs[iRef]
  return {
    nms,
    coeffs: coeffs.map((c) => (Number.isFinite(c) ? c / k : NaN)),
    validLo: nms[a],
    validHi: nms[b],
    lampT: spec.kind === 'planck' ? spec.T : NaN,
    time: Date.now(),
    source: spec.kind,
    refName: spec.kind === 'file' ? spec.ref.name : undefined,
  }
}

// Short description of the calibration source, e.g. "2856 K" or "ASTM G173"
export function responseSourceLabel(cal: ResponseCalibration): string {
  if (cal.source === 'file') return cal.refName || '?'
  return Number.isFinite(cal.lampT) ? `${cal.lampT} K` : '?'
}

// Reference spectrum file: "nm value" lines (tab, space, ; or , separated; decimal comma accepted when
// the separator is ; or tab); lines starting with # or not starting with a number are skipped.
export function referenceFromText(text: string, name: string): ReferenceSpectrum | string {
  const pts: [number, number][] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    let parts: string[]
    if (line.includes(';') || line.includes('\t')) parts = line.split(/[;\t]+/).map((s) => s.trim().replace(',', '.'))
    else parts = line.split(/[\s,]+/)
    if (parts.length < 2) continue
    const nm = Number.parseFloat(parts[0])
    const v = Number.parseFloat(parts[1])
    if (!Number.isFinite(nm) || !Number.isFinite(v) || nm <= 0 || v < 0) continue
    pts.push([nm, v])
  }
  if (pts.length < 2) return 'Err_RefFile'
  pts.sort((p, q) => p[0] - q[0])
  const nms: number[] = []
  const values: number[] = []
  for (const [nm, v] of pts) {
    if (nms.length && nm === nms[nms.length - 1]) continue
    nms.push(nm)
    values.push(v)
  }
  if (nms.length < 2) return 'Err_RefFile'
  return { name: name.replace(/\.[^.]+$/, ''), nms, values }
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
  const src =
    cal.source === 'file' ? `reference ${(cal.refName || '?').replace(/,/g, ' ')}` : `halogen ${cal.lampT} K`
  const lines = [
    `# Spectral response correction (WebSpectrometer fork), ${src}, ${new Date(cal.time).toISOString()}`,
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
  let source: ResponseSource = 'planck'
  let refName: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      const m = line.match(/halogen\s+([\d.]+)\s*K,\s*(\S+)/)
      const r = line.match(/reference\s+([^,]+),\s*(\S+)/)
      if (m) {
        lampT = Number.parseFloat(m[1])
        const d = Date.parse(m[2])
        if (Number.isFinite(d)) time = d
      } else if (r) {
        source = 'file'
        refName = r[1].trim()
        const d = Date.parse(r[2])
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
  if (nms.length < 2) return 'Err_RespFile'
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
  return { nms: g, coeffs: cg, validLo: lo, validHi: hi, lampT, time, source, refName }
}
