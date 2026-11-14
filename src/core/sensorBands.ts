// Channels of the sensor board (web-only), from the datasheets:
//  - ams AS7331: UVA peak 360 nm (320–400), UVB peak 300 nm (280–320), UVC peak 260 nm (240–280)
//  - ams AS7265x (AS72651/2/3): 18 channels A…L, peaks 410…940 nm, FWHM 20 nm each
import { wavelengthToCss } from './wavelengthColor'
import type { TriadReading, UvReading } from '../serial/uvSensor'

export const UV_CH = [
  { key: 'uvc', label: 'UVC', lo: 240, hi: 280, c: 260, color: '#3b1f5c' },
  { key: 'uvb', label: 'UVB', lo: 280, hi: 320, c: 300, color: '#5a2d8a' },
  { key: 'uva', label: 'UVA', lo: 320, hi: 400, c: 360, color: '#7e4cc2' },
] as const

export const TRIAD_FWHM = 20
/** Channel letters of the AS7265x in wavelength order (410 … 940 nm) */
export const TRIAD_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'R', 'I', 'S', 'J', 'T', 'U', 'V', 'W', 'K', 'L']

/** One sensor channel: band, peak, value (µW/cm², band total as reported) */
export interface SensorBar {
  lo: number
  hi: number
  c: number
  v: number
  color: string
  label: string // e.g. "UVA" or "435"
  sub: string // e.g. "360 nm" or "B"
  uv: boolean
}

export function uvBarsOf(r: UvReading | null): SensorBar[] {
  if (!r) return []
  return UV_CH.map((ch) => ({
    lo: ch.lo,
    hi: ch.hi,
    c: ch.c,
    v: ch.key === 'uva' ? r.uva : ch.key === 'uvb' ? r.uvb : r.uvc,
    color: ch.color,
    label: ch.label,
    sub: `${ch.c}`,
    uv: true,
  }))
}

export function triadBarsOf(r: TriadReading | null): SensorBar[] {
  if (!r) return []
  return r.values.map((v, i) => ({
    lo: r.nm[i] - TRIAD_FWHM / 2,
    hi: r.nm[i] + TRIAD_FWHM / 2,
    c: r.nm[i],
    v,
    color: wavelengthToCss(Math.min(r.nm[i], 780)),
    label: `${r.nm[i]}`,
    sub: TRIAD_LETTERS[i] ?? '',
    uv: false,
  }))
}

/** Spectral density (µW/cm²/nm): band total divided by the band width */
export const barDensity = (b: SensorBar) => b.v / (b.hi - b.lo)
