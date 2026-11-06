// Transmittance of glasses / filters / windows (web-only feature).
//
//   T(λ) = (sample − dark) / (100 % − dark)
// measured with the same light source, exposure and geometry. Wavelengths where the 100 % (blank)
// signal is too weak are left undefined (NaN): a lamp with no UV or IR cannot tell anything there.
//
// Derived values (all from T on the 5 nm CIE grid or the 1 nm grid):
// - mean transmittance per band (UV-B, UV-A, HEV blue, B, G, R, near IR) — unweighted means;
// - luminous transmittance τv = Σ D65·V·T / Σ D65·V (380–780 nm) and the ISO 12312-1 filter category;
// - colour of daylight (D65) seen through the lens: xy, CCT, Duv and colour rendering (Ra, R9);
// - sRGB swatches of the CIE test colours seen without / with the lens.

import { CIE_N, CIE_WL_START, CIE_WL_STEP, TCS, XBAR, YBAR, ZBAR } from './cieData'
import { CIE_WL, daylightSpd, lightMetrics, type LightMetrics } from './colorimetry'

export interface Snapshot {
  nmMin: number
  nmMax: number
  values: number[]
}

export interface TransCurve {
  nmStart: number // first wavelength of the 1 nm grid
  t: number[] // transmittance 0–1 (may exceed 1 slightly from noise), NaN = not measurable
}

const MIN_BLANK = 0.02 // blank signal below 2 % of its maximum → not measurable

function valueAt(s: Snapshot, nm: number): number {
  const n = s.values.length
  const f = ((nm - s.nmMin) * n) / (s.nmMax - s.nmMin)
  if (f < 0 || f > n - 1) return NaN
  const i = Math.floor(f)
  const u = f - i
  return i + 1 < n ? s.values[i] * (1 - u) + s.values[i + 1] * u : s.values[i]
}

// Average over ±0.5 nm (simple box) to get a 1 nm grid that is independent of the sensor sampling
function boxAt(s: Snapshot, nm: number): number {
  let acc = 0
  let cnt = 0
  for (let k = -2; k <= 2; k++) {
    const v = valueAt(s, nm + k * 0.25)
    if (Number.isFinite(v)) {
      acc += v
      cnt++
    }
  }
  return cnt ? acc / cnt : NaN
}

export function computeTransmission(sample: Snapshot, blank: Snapshot, dark: Snapshot | null): TransCurve | string {
  if (!(blank.nmMax > blank.nmMin)) return 'Spectrum not calibrated in wavelength'
  const lo = Math.ceil(Math.max(sample.nmMin, blank.nmMin))
  const hi = Math.floor(
    Math.min(
      sample.nmMin + ((sample.nmMax - sample.nmMin) * (sample.values.length - 1)) / sample.values.length,
      blank.nmMin + ((blank.nmMax - blank.nmMin) * (blank.values.length - 1)) / blank.values.length,
    ),
  )
  if (!(hi > lo)) return 'No common wavelength range'
  const nms: number[] = []
  const b: number[] = []
  const s: number[] = []
  for (let nm = lo; nm <= hi; nm++) {
    const d = dark ? boxAt(dark, nm) : 0
    nms.push(nm)
    b.push(boxAt(blank, nm) - (Number.isFinite(d) ? d : 0))
    s.push(boxAt(sample, nm) - (Number.isFinite(d) ? d : 0))
  }
  const bMax = Math.max(...b.filter(Number.isFinite))
  if (!(bMax > 0)) return 'No signal in the 100 % spectrum'
  const t = b.map((bv, i) => (bv >= MIN_BLANK * bMax ? Math.max(0, s[i]) / bv : NaN))
  return { nmStart: lo, t }
}

export function tAt(c: TransCurve, nm: number): number {
  const f = nm - c.nmStart
  if (f < 0 || f > c.t.length - 1) return NaN
  const i = Math.floor(f)
  const u = f - i
  const a = c.t[i]
  const b = c.t[Math.min(i + 1, c.t.length - 1)]
  return Number.isFinite(b) ? a * (1 - u) + b * u : a
}

export interface BandDef {
  key: string
  lo: number
  hi: number
}

export const TRANS_BANDS: BandDef[] = [
  { key: 'UVB', lo: 280, hi: 315 },
  { key: 'UVA', lo: 315, hi: 380 },
  { key: 'HEV', lo: 400, hi: 455 }, // "blue light" band of blue-light filtering lenses
  { key: 'B', lo: 400, hi: 500 },
  { key: 'G', lo: 500, hi: 600 },
  { key: 'R', lo: 600, hi: 700 },
  { key: 'IR', lo: 780, hi: 1000 },
]

export interface BandT {
  key: string
  lo: number
  hi: number
  mean: number | null // mean T over the measurable part of the band (0–1)
  coverage: number // measurable fraction of the band (0–1)
}

export function bandMeans(c: TransCurve): BandT[] {
  return TRANS_BANDS.map((b) => {
    let acc = 0
    let cnt = 0
    let total = 0
    for (let nm = b.lo; nm <= b.hi; nm++) {
      total++
      const v = tAt(c, nm)
      if (Number.isFinite(v)) {
        acc += v
        cnt++
      }
    }
    return { key: b.key, lo: b.lo, hi: b.hi, mean: cnt ? acc / cnt : null, coverage: total ? cnt / total : 0 }
  })
}

// T on the CIE 5 nm grid (NaN where not measurable)
export function tOnCieGrid(c: TransCurve): number[] {
  return CIE_WL.map((w) => tAt(c, w))
}

const D65 = daylightSpd(6504)

export interface Luminous {
  tauV: number | null // 0–1
  category: number | null // ISO 12312-1 filter category 0–4; 5 = below category 4
  coverage: number // V(λ)·D65-weighted fraction of 380–780 nm that is measurable
}

// ISO 12312-1: cat 0 > 80 %, 1: 43–80 %, 2: 18–43 %, 3: 8–18 %, 4: 3–8 %
export function luminousTransmittance(c: TransCurve): Luminous {
  const tg = tOnCieGrid(c)
  let num = 0
  let den = 0
  let all = 0
  for (let i = 0; i < CIE_N; i++) {
    const w = D65[i] * YBAR[i]
    all += w
    if (Number.isFinite(tg[i])) {
      num += w * tg[i]
      den += w
    }
  }
  if (!(den > 0)) return { tauV: null, category: null, coverage: 0 }
  const tauV = num / den
  const p = tauV * 100
  const category = p > 80 ? 0 : p > 43 ? 1 : p > 18 ? 2 : p > 8 ? 3 : p >= 3 ? 4 : 5
  return { tauV, category, coverage: den / all }
}

// Daylight seen through the lens (no chromatic adaptation): colour and colour rendering of D65·T
export function daylightThrough(c: TransCurve): { lens: LightMetrics | null; coverage: number } {
  const tg = tOnCieGrid(c)
  const spd = D65.map((d, i) => (Number.isFinite(tg[i]) ? d * tg[i] : NaN))
  const measured = tg.filter(Number.isFinite).length
  return { lens: lightMetrics(spd), coverage: measured / CIE_N }
}

// XYZ (D65 white Y = 1) → sRGB hex
function xyzToHex(X: number, Y: number, Z: number): string {
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z
  const enc = (v: number) => {
    const x = Math.max(0, Math.min(1, v))
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${enc(r)}${enc(g)}${enc(b)}`
}

export interface Swatch {
  name: string
  without: string // sRGB under D65
  through: string // sRGB of the same colour seen through the lens (unadapted, keeps the lens tint)
}

const SWATCH_NAMES = ['TCS01', 'TCS02', 'TCS03', 'TCS04', 'TCS05', 'TCS06', 'TCS07', 'TCS08', 'TCS09', 'TCS10', 'TCS11', 'TCS12', 'TCS13', 'TCS14']

// White (perfect diffuser) is included first. Missing T values are treated as 1 so that a partly
// measured lens does not produce black swatches; the coverage warning tells the user.
export function swatches(c: TransCurve): Swatch[] {
  const tg = tOnCieGrid(c).map((v) => (Number.isFinite(v) ? v : 1))
  let Yw = 0
  for (let i = 0; i < CIE_N; i++) Yw += D65[i] * YBAR[i]
  const col = (refl: number[] | null, withLens: boolean) => {
    let X = 0
    let Y = 0
    let Z = 0
    for (let i = 0; i < CIE_N; i++) {
      const e = D65[i] * (refl ? refl[i] : 1) * (withLens ? tg[i] : 1)
      X += e * XBAR[i]
      Y += e * YBAR[i]
      Z += e * ZBAR[i]
    }
    return xyzToHex(X / Yw, Y / Yw, Z / Yw)
  }
  const out: Swatch[] = [{ name: 'White', without: col(null, false), through: col(null, true) }]
  TCS.forEach((r, i) => out.push({ name: SWATCH_NAMES[i], without: col(r, false), through: col(r, true) }))
  return out
}

export function curveToCsv(curves: { label: string; curve: TransCurve }[]): string {
  if (curves.length === 0) return ''
  const lo = Math.min(...curves.map((c) => c.curve.nmStart))
  const hi = Math.max(...curves.map((c) => c.curve.nmStart + c.curve.t.length - 1))
  const lines = [['nm', ...curves.map((c) => `${c.label} T%`)].join(';')]
  for (let nm = lo; nm <= hi; nm++) {
    lines.push(
      [nm, ...curves.map((c) => {
        const v = tAt(c.curve, nm)
        return Number.isFinite(v) ? (v * 100).toFixed(2) : ''
      })].join(';'),
    )
  }
  return lines.join('\n') + '\n'
}

export { CIE_WL_START, CIE_WL_STEP }
