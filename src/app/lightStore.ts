// State for the Light quality window (web-only): spectral response calibration and lux calibration.
// Both are kept in localStorage (per site origin) and can also be saved/loaded as files.
import { useSyncExternalStore } from 'react'
import { applyResponse, calibrateResponseWith, type ReferenceSpec, type ResponseCalibration } from '../core/responseCal'
import { lightMetrics, toCieGrid, type LightMetrics } from '../core/colorimetry'
import { pipeline, setResponseCorrection } from './engine'
import { getState } from './store'

const RESP_KEY = 'webspectrometer.responseCalibration'
const LUX_KEY = 'webspectrometer.luxCalibration'

export interface LuxCalibration {
  factor: number | null // lx per unit of photometric sum
  responseTime: number | null // response calibration the lux factor was made with
  distance: number | null // m, for luminous intensity (cd = lx·d²)
  watts: number | null // electrical power, for lx/W
}

interface LightState {
  response: ResponseCalibration | null
  lux: LuxCalibration
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore (private mode / storage full)
  }
}

function loadResponse(): ResponseCalibration | null {
  const r = load<ResponseCalibration | null>(RESP_KEY, null)
  if (!r || !Array.isArray(r.nms)) return null
  // JSON stores NaN as null
  return { ...r, coeffs: r.coeffs.map((c) => (c == null ? NaN : c)) }
}

let state: LightState = {
  response: loadResponse(),
  lux: load<LuxCalibration>(LUX_KEY, { factor: null, responseTime: null, distance: null, watts: null }),
}
const listeners = new Set<() => void>()
function set(patch: Partial<LightState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useLight(): LightState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

// Illuminance from a photometric sum (null without a lux calibration)
export function getLux(photometricSum: number): number | null {
  return state.lux.factor != null ? state.lux.factor * photometricSum : null
}

export function getLightResponse(): ResponseCalibration | null {
  return state.response
}

export function setResponse(r: ResponseCalibration | null): void {
  save(RESP_KEY, r)
  set({ response: r })
  setResponseCorrection(r)
}

// Hand the stored calibration to the engine at start-up
setResponseCorrection(state.response)

export function calibrateResponseFromCurrent(spec: ReferenceSpec | number): string | null {
  const s: ReferenceSpec = typeof spec === 'number' ? { kind: 'planck', T: spec } : spec
  // A clipped spectrum would bake the clipping into the correction
  const v = pipeline.uncorrected
  let peak = 0
  for (let i = 0; i < v.length; i++) if (v[i] > peak) peak = v[i]
  if (peak >= 0.97 * FULL_SCALE) return 'Lq_ErrSaturated'
  // Always from the spectrum before any response correction
  const r = calibrateResponseWith(v, pipeline.nmMin, pipeline.nmMax, s)
  if (typeof r === 'string') return r
  setResponse(r)
  return null
}

export function setLux(patch: Partial<LuxCalibration>): void {
  const lux = { ...state.lux, ...patch }
  save(LUX_KEY, lux)
  set({ lux })
}

export const FULL_SCALE = 65280 // 255 × 256: camera samples after scale unification

export interface CurrentLight {
  metrics: LightMetrics | null
  corrected: boolean
  saturated: boolean
  calibrated: boolean // wavelength calibration present
  calibrationSuspect: boolean // calibration points imply very uneven dispersion (a misidentified line)
  uva: UvaShare | null // UV-A share of the measured radiation (null without wavelength calibration)
}

// UV-A within the spectrometer's reach. Silicon webcam spectrometers with a DVD / plastic grating and
// glass optics see nothing below ≈340 nm, so the band is integrated from UVA_LO, not from 315 nm.
export const UVA_LO = 340
export const UVA_HI = 400
const VIS_HI = 780

export interface UvaShare {
  percent: number // UV-A energy / energy in UVA_LO–780 nm, %
  lo: number // lower limit actually integrated (nm): UVA_LO, or higher if data/correction start later
  covered: boolean // the whole UVA_LO–UVA_HI range has data
}

// Energy share of UVA_LO–UVA_HI nm in UVA_LO–780 nm (NaN samples skipped); null if no data in the band
export function uvaShare(values: ArrayLike<number>, nmMin: number, nmMax: number): UvaShare | null {
  const n = values.length
  if (n < 10 || !(nmMax > nmMin)) return null
  let uv = 0
  let all = 0
  let lo = Infinity
  for (let i = 0; i < n; i++) {
    const nm = nmMin + ((nmMax - nmMin) * i) / n
    if (nm < UVA_LO || nm > VIS_HI) continue
    const x = values[i]
    if (!Number.isFinite(x)) continue
    const val = Math.max(0, x)
    all += val
    if (nm <= UVA_HI) {
      uv += val
      if (nm < lo) lo = nm
    }
  }
  if (!(all > 0) || !Number.isFinite(lo)) return null
  return { percent: (100 * uv) / all, lo: Math.round(lo), covered: lo <= UVA_LO + 2 }
}

// A grating spectrometer is close to linear: nm per bin should not change much between calibration
// segments. A ratio above 1.5 almost always means a calibration point was assigned to the wrong line.
export function calibrationLooksWrong(): boolean {
  const { bins, nms } = getState().calibration
  if (!bins || bins.length < 3) return false
  const slopes: number[] = []
  for (let i = 0; i + 1 < bins.length; i++) {
    const db = bins[i + 1] - bins[i]
    if (db !== 0) slopes.push(Math.abs((nms[i + 1] - nms[i]) / db))
  }
  if (slopes.length < 2) return false
  return Math.max(...slopes) / Math.min(...slopes) > 1.5
}

// Metrics of the spectrum shown now (response-corrected when a response calibration exists)
export function currentLight(): CurrentLight {
  // Uncorrected spectrum: the correction is applied below (independent of the Corrected toggle)
  const { uncorrected: v, nmMin, nmMax } = pipeline
  const calibrated = nmMax > nmMin
  let peak = 0
  for (let i = 0; i < v.length; i++) if (v[i] > peak) peak = v[i]
  const saturated = peak >= 0.97 * FULL_SCALE
  const calibrationSuspect = calibrationLooksWrong()
  if (!calibrated) return { metrics: null, corrected: false, saturated, calibrated, calibrationSuspect, uva: null }
  const resp = state.response
  const corr = resp ? applyResponse(v, nmMin, nmMax, resp) : v
  const spd = toCieGrid(corr, nmMin, nmMax)
  return { metrics: lightMetrics(spd), corrected: !!resp, saturated, calibrated, calibrationSuspect, uva: uvaShare(corr, nmMin, nmMax) }
}
