// Full width at half maximum (FWHM) of spectral peaks.
// Web-only feature (not in the original Theremino program).
//
// Works on the raw visible samples (data space), so the result is independent of the
// display (zoom, Log scale, canvas width). The nm axis of the pipeline is linear
// (nm = nmMin + (nmMax − nmMin)·idx/n), so a width in samples converts to nm by a constant.
//
// Baseline follows the prominence convention (as in scipy.signal.peak_widths, rel_height=0.5):
// walk outward from the peak on each side until a sample higher than the peak (or the window
// edge) is reached, take the minimum on each side, and use the HIGHER of the two minima as
// the base. Half level = base + (top − base)/2. With baseline 'zero' the base is 0.

export type FwhmBaseline = 'local' | 'zero'

export interface FwhmResult {
  center: number // fractional sample index of the apex (parabolic interpolation)
  top: number // interpolated apex value
  base: number
  half: number // half-maximum level
  left: number // fractional sample index of the left half-level crossing
  right: number // fractional sample index of the right half-level crossing
  width: number // right − left, in samples
  prominence: number // top − base
}

export function measureFwhm(
  v: ArrayLike<number>,
  peakIndex: number,
  baseline: FwhmBaseline = 'local',
): FwhmResult | null {
  const n = v.length
  const i = peakIndex
  if (i <= 0 || i >= n - 1) return null
  const vi = v[i]

  // Apex: parabola through (i−1, i, i+1)
  const a = v[i - 1]
  const c = v[i + 1]
  const den = a - 2 * vi + c
  let d = den !== 0 ? (0.5 * (a - c)) / den : 0
  if (d > 0.5) d = 0.5
  if (d < -0.5) d = -0.5
  const center = i + d
  const top = vi - 0.25 * (a - c) * d

  // Side minima up to the first higher sample (prominence bases)
  let lMin = vi
  for (let j = i - 1; j >= 0 && v[j] <= vi; j--) if (v[j] < lMin) lMin = v[j]
  let rMin = vi
  for (let j = i + 1; j < n && v[j] <= vi; j++) if (v[j] < rMin) rMin = v[j]
  const localBase = Math.max(lMin, rMin)
  const base = baseline === 'zero' ? 0 : localBase
  const prominence = top - localBase
  if (top - base <= 0) return null
  const half = base + (top - base) / 2

  // Half-level crossings, linear interpolation between neighbouring samples
  let left = -1
  for (let j = i; j > 0; j--) {
    if (v[j - 1] < half && v[j] >= half) {
      left = j - 1 + (half - v[j - 1]) / (v[j] - v[j - 1])
      break
    }
  }
  let right = -1
  for (let j = i; j < n - 1; j++) {
    if (v[j + 1] < half && v[j] >= half) {
      right = j + (v[j] - half) / (v[j] - v[j + 1])
      break
    }
  }
  if (left < 0 || right < 0) return null // the peak does not drop to half level inside the window

  return { center, top, base, half, left, right, width: right - left, prominence }
}
