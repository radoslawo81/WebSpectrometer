// Reference spectral lines (web-only feature). Wavelengths in air, nm (NIST ASD values rounded to
// 0.01 nm). Used by the automatic calibration, peak identification and the second-order markers.
//
// kind: 'emission' lines appear as peaks, 'absorption' (Fraunhofer / telluric) as dips.
// cal: true = sharp, isolated and bright enough in typical lamps to serve as a calibration point.
// approx: phosphor bands of fluorescent lamps — usable for identification, position ± ~1 nm.

export interface RefLine {
  nm: number
  label: string // e.g. "Hg", "Ar", "Hα"
  set: LineSet
  kind: 'emission' | 'absorption'
  strength: number // rough relative intensity 1–10 in a typical source of this set
  cal?: boolean
  approx?: boolean
}

export type LineSet = 'Hg' | 'Ar' | 'Ne' | 'Na' | 'H' | 'He' | 'CFL' | 'Sun'

export const LINE_SETS: { key: LineSet; name: string }[] = [
  { key: 'Hg', name: 'Mercury (Hg)' },
  { key: 'Ar', name: 'Argon (Ar)' },
  { key: 'Ne', name: 'Neon (Ne)' },
  { key: 'Na', name: 'Sodium (Na)' },
  { key: 'H', name: 'Hydrogen (H)' },
  { key: 'He', name: 'Helium (He)' },
  { key: 'CFL', name: 'Fluorescent phosphors (Eu, Tb)' },
  { key: 'Sun', name: 'Sun: Fraunhofer & telluric' },
]

const e = (nm: number, label: string, set: LineSet, strength: number, cal = false, approx = false): RefLine => ({
  nm,
  label,
  set,
  kind: 'emission',
  strength,
  cal,
  approx,
})
const a = (nm: number, label: string, strength: number, cal = true): RefLine => ({
  nm,
  label,
  set: 'Sun',
  kind: 'absorption',
  strength,
  cal,
})

export const LINES: RefLine[] = [
  // Mercury (low-pressure lamps, fluorescent tubes, UVC germicidal lamps)
  e(253.65, 'Hg', 'Hg', 10),
  e(296.73, 'Hg', 'Hg', 3),
  e(302.15, 'Hg', 'Hg', 2),
  e(312.57, 'Hg', 'Hg', 3),
  e(313.16, 'Hg', 'Hg', 3),
  e(334.15, 'Hg', 'Hg', 2, true),
  e(365.02, 'Hg', 'Hg', 6, true),
  e(365.48, 'Hg', 'Hg', 3),
  e(366.33, 'Hg', 'Hg', 2),
  e(404.66, 'Hg', 'Hg', 7, true),
  e(407.78, 'Hg', 'Hg', 3, true),
  e(435.83, 'Hg', 'Hg', 9, true),
  e(491.6, 'Hg', 'Hg', 2, true),
  e(546.07, 'Hg', 'Hg', 10, true),
  e(576.96, 'Hg', 'Hg', 7, true),
  e(579.07, 'Hg', 'Hg', 7, true),
  e(1013.98, 'Hg', 'Hg', 4),
  // Argon (filler gas of Hg lamps, Ar discharge)
  e(696.54, 'Ar', 'Ar', 6, true),
  e(706.72, 'Ar', 'Ar', 6, true),
  e(714.7, 'Ar', 'Ar', 2, true),
  e(727.29, 'Ar', 'Ar', 4, true),
  e(738.4, 'Ar', 'Ar', 6, true),
  e(750.39, 'Ar', 'Ar', 8),
  e(751.47, 'Ar', 'Ar', 7),
  e(763.51, 'Ar', 'Ar', 10, true),
  e(772.38, 'Ar', 'Ar', 7, true),
  e(794.82, 'Ar', 'Ar', 7, true),
  e(800.62, 'Ar', 'Ar', 6),
  e(801.48, 'Ar', 'Ar', 6),
  e(810.37, 'Ar', 'Ar', 8),
  e(811.53, 'Ar', 'Ar', 9),
  e(826.45, 'Ar', 'Ar', 6, true),
  e(840.82, 'Ar', 'Ar', 6),
  e(842.46, 'Ar', 'Ar', 7),
  e(852.14, 'Ar', 'Ar', 5, true),
  e(866.79, 'Ar', 'Ar', 2, true),
  e(912.3, 'Ar', 'Ar', 7, true),
  e(922.45, 'Ar', 'Ar', 4, true),
  e(965.78, 'Ar', 'Ar', 3, true),
  e(978.45, 'Ar', 'Ar', 1),
  // Neon (indicator lamps, Ne discharge)
  e(540.06, 'Ne', 'Ne', 3, true),
  e(585.25, 'Ne', 'Ne', 9, true),
  e(588.19, 'Ne', 'Ne', 5, true),
  e(594.48, 'Ne', 'Ne', 6, true),
  e(597.55, 'Ne', 'Ne', 4),
  e(603.0, 'Ne', 'Ne', 3),
  e(607.43, 'Ne', 'Ne', 6, true),
  e(609.62, 'Ne', 'Ne', 6, true),
  e(614.31, 'Ne', 'Ne', 7, true),
  e(616.36, 'Ne', 'Ne', 5),
  e(621.73, 'Ne', 'Ne', 5),
  e(626.65, 'Ne', 'Ne', 6, true),
  e(630.48, 'Ne', 'Ne', 5),
  e(633.44, 'Ne', 'Ne', 7, true),
  e(638.3, 'Ne', 'Ne', 7, true),
  e(640.22, 'Ne', 'Ne', 10, true),
  e(650.65, 'Ne', 'Ne', 7, true),
  e(653.29, 'Ne', 'Ne', 4),
  e(659.9, 'Ne', 'Ne', 5, true),
  e(667.83, 'Ne', 'Ne', 6, true),
  e(671.7, 'Ne', 'Ne', 5, true),
  e(692.95, 'Ne', 'Ne', 6, true),
  e(703.24, 'Ne', 'Ne', 7, true),
  e(717.39, 'Ne', 'Ne', 3),
  e(724.52, 'Ne', 'Ne', 4),
  e(743.89, 'Ne', 'Ne', 3),
  // Sodium
  e(588.99, 'Na D2', 'Na', 10, true),
  e(589.59, 'Na D1', 'Na', 9, true),
  e(818.33, 'Na', 'Na', 4),
  e(819.48, 'Na', 'Na', 5),
  // Hydrogen (Balmer)
  e(410.17, 'Hδ', 'H', 2),
  e(434.05, 'Hγ', 'H', 4, true),
  e(486.13, 'Hβ', 'H', 7, true),
  e(656.28, 'Hα', 'H', 10, true),
  // Helium
  e(388.87, 'He', 'He', 5, true),
  e(447.15, 'He', 'He', 6, true),
  e(471.31, 'He', 'He', 3),
  e(492.19, 'He', 'He', 3),
  e(501.57, 'He', 'He', 6, true),
  e(587.56, 'He', 'He', 10, true),
  e(667.82, 'He', 'He', 6, true),
  e(706.52, 'He', 'He', 5, true),
  // Fluorescent lamp phosphors (band maxima, approximate)
  e(487.7, 'Tb', 'CFL', 5, false, true),
  e(543.4, 'Tb', 'CFL', 8, false, true),
  e(586.0, 'Tb', 'CFL', 3, false, true),
  e(593.0, 'Eu', 'CFL', 4, false, true),
  e(599.0, 'Eu', 'CFL', 4, false, true),
  e(611.6, 'Eu', 'CFL', 10, true, true),
  e(621.7, 'Tb', 'CFL', 3, false, true),
  e(626.0, 'Eu', 'CFL', 4, false, true),
  e(650.0, 'Eu', 'CFL', 3, false, true),
  e(707.0, 'Eu', 'CFL', 3, false, true),
  e(710.0, 'Eu', 'CFL', 3, false, true),
  // Sun: Fraunhofer lines and telluric (atmospheric) bands — absorption dips
  a(393.37, 'Ca II K', 7),
  a(396.85, 'Ca II H', 7),
  a(430.8, 'G (CH)', 5, false),
  a(486.13, 'Hβ (F)', 6),
  a(517.27, 'Mg b', 5),
  a(518.36, 'Mg b', 4, false),
  a(527.04, 'Fe (E)', 3),
  a(589.3, 'Na D', 6),
  a(656.28, 'Hα (C)', 7),
  a(687.1, 'O₂ B', 6), // band minimum at ~1 nm resolution (band head 686.7)
  a(760.3, 'O₂ A', 10), // band minimum at ~1 nm resolution (band head 759.4)
  a(822.7, 'H₂O', 3, false),
  a(934.0, 'H₂O', 5, false),
]

export function linesOf(sets: LineSet[]): RefLine[] {
  const s = new Set(sets)
  return LINES.filter((l) => s.has(l.set))
}

export interface LineMatch {
  line: RefLine
  order: 1 | 2
  delta: number // measured − expected (nm)
}

// Nearest reference lines to a measured wavelength (first and optionally second diffraction order)
export function identify(nm: number, sets: LineSet[], tol = 2, secondOrder = true): LineMatch[] {
  const out: LineMatch[] = []
  for (const l of linesOf(sets)) {
    const d1 = nm - l.nm
    if (Math.abs(d1) <= tol + (l.approx ? 1 : 0)) out.push({ line: l, order: 1, delta: d1 })
    if (secondOrder && l.kind === 'emission') {
      const d2 = nm - 2 * l.nm
      if (Math.abs(d2) <= tol * 1.5) out.push({ line: l, order: 2, delta: d2 })
    }
  }
  // Prefer closer, stronger, first order
  out.sort((p, q) => Math.abs(p.delta) - Math.abs(q.delta) + (p.order - q.order) * 0.5 - (p.line.strength - q.line.strength) * 0.05)
  return out
}

// Calibration sources for the automatic calibration
export interface CalSource {
  key: string
  name: string
  sets: LineSet[]
  kind: 'emission' | 'absorption'
}

export const CAL_SOURCES: CalSource[] = [
  { key: 'cfl', name: 'Fluorescent lamp / CFL (Hg + phosphors)', sets: ['Hg', 'CFL'], kind: 'emission' },
  { key: 'hgar', name: 'UVC germicidal / Hg-Ar lamp', sets: ['Hg', 'Ar'], kind: 'emission' },
  { key: 'ne', name: 'Neon lamp', sets: ['Ne'], kind: 'emission' },
  { key: 'na', name: 'Sodium lamp', sets: ['Na'], kind: 'emission' },
  { key: 'h', name: 'Hydrogen tube', sets: ['H'], kind: 'emission' },
  { key: 'he', name: 'Helium tube', sets: ['He'], kind: 'emission' },
  { key: 'sun', name: 'Sunlight / daylight (Fraunhofer lines)', sets: ['Sun'], kind: 'absorption' },
]
