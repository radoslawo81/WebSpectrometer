// Colorimetry & photometry from a spectral power distribution (web-only feature).
//
// Input: a relative SPD on the 380–780 nm / 5 nm grid (81 values; NaN = not measured).
// Output: CIE 1931 xy, CIE 1960 uv, CCT + Duv, CIE 13.3 CRI (R1–R14, Ra), luminous efficacy of
// radiation (LER) and a photometric sum used for lux once calibrated against a lux meter.
//
// The SPD must be corrected for the spectral response of the spectrometer (see responseCal.ts),
// otherwise all of these numbers are biased by the camera/grating sensitivity.

import { CIE_N, CIE_WL_START, CIE_WL_STEP, D_S0, D_S1, D_S2, TCS, XBAR, YBAR, ZBAR } from './cieData'

export const CIE_WL: number[] = Array.from({ length: CIE_N }, (_, i) => CIE_WL_START + i * CIE_WL_STEP)

const C2 = 1.4388e-2 // m·K, second radiation constant (CIE 15 value)

// Planck spectral radiance, relative (constant factors dropped)
export function planck(nm: number, T: number): number {
  const l = nm * 1e-9
  return 1 / (Math.pow(l, 5) * (Math.exp(C2 / (l * T)) - 1))
}

function planckSpd(T: number): number[] {
  return CIE_WL.map((w) => planck(w, T))
}

// CIE D-series daylight SPD for a given CCT (4000–25000 K), CIE 15 formulae
export function daylightSpd(T: number): number[] {
  // CCT scaled by 1.4388/1.438 as in CIE 15:2004 for the D-series locus
  const t = (T * 1.4388) / 1.438
  const xD =
    t <= 7000
      ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
      : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704
  const yD = -3 * xD * xD + 2.87 * xD - 0.275
  const M = 0.0241 + 0.2562 * xD - 0.7341 * yD
  const M1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / M
  const M2 = (0.03 - 31.4424 * xD + 30.0717 * yD) / M
  return D_S0.map((s0, i) => s0 + M1 * D_S1[i] + M2 * D_S2[i])
}

export interface XYZ {
  X: number
  Y: number
  Z: number
}

export function xyz(spd: number[], refl?: number[]): XYZ {
  let X = 0
  let Y = 0
  let Z = 0
  for (let i = 0; i < CIE_N; i++) {
    const s = (spd[i] || 0) * (refl ? refl[i] : 1)
    X += s * XBAR[i]
    Y += s * YBAR[i]
    Z += s * ZBAR[i]
  }
  return { X, Y, Z }
}

function uv1960({ X, Y, Z }: XYZ): [number, number] {
  const d = X + 15 * Y + 3 * Z
  return d > 0 ? [(4 * X) / d, (6 * Y) / d] : [NaN, NaN]
}

// Planckian locus in CIE 1960 uv, computed from the CMFs (cached per temperature)
const locusCache = new Map<number, [number, number]>()
function planckUv(T: number): [number, number] {
  const key = Math.round(T * 10)
  let uv = locusCache.get(key)
  if (!uv) {
    uv = uv1960(xyz(planckSpd(T)))
    if (locusCache.size > 5000) locusCache.clear()
    locusCache.set(key, uv)
  }
  return uv
}

// CCT and Duv: minimum distance to the Planckian locus in uv (coarse log scan + golden-section search).
// Duv > 0 above the locus (greenish), < 0 below (pinkish).
export function cctDuv(u: number, v: number): { cct: number; duv: number } | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  const dist = (T: number) => {
    const [pu, pv] = planckUv(T)
    return Math.hypot(u - pu, v - pv)
  }
  let bestT = 1000
  let best = Infinity
  for (let lt = Math.log(1000); lt <= Math.log(100000); lt += 0.01) {
    const T = Math.exp(lt)
    const d = dist(T)
    if (d < best) {
      best = d
      bestT = T
    }
  }
  let a = bestT * Math.exp(-0.011)
  let b = bestT * Math.exp(0.011)
  const g = (Math.sqrt(5) - 1) / 2
  for (let k = 0; k < 60; k++) {
    const c = b - g * (b - a)
    const d = a + g * (b - a)
    if (dist(c) < dist(d)) b = d
    else a = c
  }
  const T = (a + b) / 2
  const [pu, pv] = planckUv(T)
  const duv = Math.sign(v - pv) * Math.hypot(u - pu, v - pv)
  return { cct: T, duv }
}

export interface CriResult {
  Ri: number[] // R1..R14
  Ra: number // mean of R1..R8
  reference: 'Planck' | 'D-series'
}

// CIE 13.3-1995 colour rendering index
export function cri(spd: number[], cct: number): CriResult {
  const ref = cct < 5000 ? planckSpd(cct) : daylightSpd(cct)
  const norm = (s: number[]) => {
    const Y = xyz(s).Y
    return s.map((v) => ((v || 0) * 100) / Y)
  }
  const sk = norm(spd)
  const sr = norm(ref)
  const cd = (u: number, v: number) => [(4 - u - 10 * v) / v, (1.708 * v + 0.404 - 1.481 * u) / v]
  const [uk, vk] = uv1960(xyz(sk))
  const [ur, vr] = uv1960(xyz(sr))
  const [ck, dk] = cd(uk, vk)
  const [cr, dr] = cd(ur, vr)

  const uvw = (Yi: number, ui: number, vi: number, u0: number, v0: number) => {
    const W = 25 * Math.cbrt(Yi) - 17
    return [13 * W * (ui - u0), 13 * W * (vi - v0), W]
  }

  const Ri = TCS.map((refl) => {
    // Test source, von Kries-adapted to the reference
    const Xk = xyz(sk, refl)
    const [uki, vki] = uv1960(Xk)
    const [cki, dki] = cd(uki, vki)
    const den = 16.518 + 1.481 * (cr / ck) * cki - (dr / dk) * dki
    const ua = (10.872 + 0.404 * (cr / ck) * cki - 4 * (dr / dk) * dki) / den
    const va = 5.52 / den
    const t = uvw(Xk.Y, ua, va, ur, vr)
    // Reference
    const Xr = xyz(sr, refl)
    const [uri, vri] = uv1960(Xr)
    const r = uvw(Xr.Y, uri, vri, ur, vr)
    const dE = Math.hypot(t[0] - r[0], t[1] - r[1], t[2] - r[2])
    return 100 - 4.6 * dE
  })
  const Ra = Ri.slice(0, 8).reduce((s, x) => s + x, 0) / 8
  return { Ri, Ra, reference: cct < 5000 ? 'Planck' : 'D-series' }
}

export interface LightMetrics {
  x: number
  y: number
  u: number
  v: number
  cct: number | null
  duv: number | null
  cri: CriResult | null
  ler: number // lm per W of optical power within 380–780 nm
  photometricSum: number // Σ S·V(λ)·Δλ, relative units (× lux factor → lx)
  coverage: [number, number] // measured part of 380–780 nm
  coverageFraction: number // share of V(λ)-weighted range that was measured (0–1)
}

export function lightMetrics(spd: number[]): LightMetrics | null {
  let first = -1
  let last = -1
  let vMeasured = 0
  let vTotal = 0
  for (let i = 0; i < CIE_N; i++) {
    vTotal += YBAR[i]
    if (Number.isFinite(spd[i])) {
      if (first < 0) first = i
      last = i
      vMeasured += YBAR[i]
    }
  }
  if (first < 0) return null
  const s = spd.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0))
  const t = xyz(s)
  if (!(t.Y > 0)) return null
  const sum = t.X + t.Y + t.Z
  const [u, v] = uv1960(t)
  const cd = cctDuv(u, v)
  let radiant = 0
  for (let i = 0; i < CIE_N; i++) radiant += s[i]
  const ler = radiant > 0 ? (683 * t.Y) / radiant : 0
  return {
    x: t.X / sum,
    y: t.Y / sum,
    u,
    v,
    cct: cd?.cct ?? null,
    duv: cd?.duv ?? null,
    cri: cd && cd.cct >= 1000 && cd.cct <= 25000 ? cri(s, cd.cct) : null,
    ler,
    photometricSum: t.Y * CIE_WL_STEP,
    coverage: [CIE_WL[first], CIE_WL[last]],
    coverageFraction: vTotal > 0 ? vMeasured / vTotal : 0,
  }
}

// Resample a spectrum given on a linear nm grid (nm = nmMin + (nmMax − nmMin)·i/n) to the 5 nm CIE grid,
// averaging over each ±2.5 nm interval. Points outside the measured range (or masked) become NaN.
export function toCieGrid(values: ArrayLike<number>, nmMin: number, nmMax: number, valid?: (nm: number) => boolean): number[] {
  const n = values.length
  const step = (nmMax - nmMin) / n
  const out: number[] = []
  for (const w of CIE_WL) {
    const lo = w - CIE_WL_STEP / 2
    const hi = w + CIE_WL_STEP / 2
    if (lo < nmMin || hi > nmMin + step * (n - 1) || (valid && !valid(w))) {
      out.push(NaN)
      continue
    }
    const i0 = Math.max(0, Math.ceil((lo - nmMin) / step))
    const i1 = Math.min(n - 1, Math.floor((hi - nmMin) / step))
    let acc = 0
    let cnt = 0
    for (let i = i0; i <= i1; i++) {
      acc += values[i]
      cnt++
    }
    out.push(cnt > 0 ? acc / cnt : NaN)
  }
  return out
}
