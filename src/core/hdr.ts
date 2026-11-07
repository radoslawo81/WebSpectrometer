// HDR merge of two exposures (web-only feature).
// short: no clipping (strong lines measured correctly); long: weak features above noise.
// Scale k = median(long/short) over samples where the long exposure is not saturated, both are
// well above the noise and the long one is below 85 % of its maximum. Merged = long where valid,
// otherwise k·short (the long exposure's units).

export interface HdrShot {
  nmMin: number
  nmMax: number
  values: number[]
  saturated: number[] | null // clipped-pixel counts per sample (from the camera), null if unknown
}

export interface HdrResult {
  values: number[]
  k: number // long/short exposure ratio
  replaced: number // samples taken from the short exposure
  overlap: number // samples used to estimate k
}

export function mergeHdr(short: HdrShot, long: HdrShot): HdrResult | string {
  const n = long.values.length
  if (short.values.length !== n || Math.abs(short.nmMin - long.nmMin) > 1e-6 || Math.abs(short.nmMax - long.nmMax) > 1e-6) {
    return 'Hd_ErrAxis'
  }
  const lMax = Math.max(...long.values)
  const sMax = Math.max(...short.values)
  if (!(lMax > 0 && sMax > 0)) return 'Err_NoSignal'
  // Invalid in the long exposure: saturated (± 3 samples) or above 97 % of its max
  const bad = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const sat = (long.saturated && long.saturated[i] >= 2) || long.values[i] >= 0.97 * lMax
    if (sat) for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) bad[j] = 1
  }
  const ratios: number[] = []
  for (let i = 0; i < n; i++) {
    if (bad[i]) continue
    const s = short.values[i]
    const l = long.values[i]
    if (s > 0.1 * sMax && l > 0.05 * lMax && l < 0.85 * lMax) ratios.push(l / s)
  }
  if (ratios.length < 10) return 'Hd_ErrOverlap'
  ratios.sort((a, b) => a - b)
  const k = ratios[Math.floor(ratios.length / 2)]
  let replaced = 0
  const values = long.values.map((l, i) => {
    if (bad[i]) {
      replaced++
      return short.values[i] * k
    }
    return l
  })
  return { values, k, replaced, overlap: ratios.length }
}
