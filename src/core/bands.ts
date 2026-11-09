// Spectral bands shown as a coloured bar under the graph (web-only).
// UV limits after CIE / ISO 21348 (UVC 100–280, UVB 280–315, UVA 315–400 nm), visible colour names
// after the usual textbook ranges, IR from 780 nm (CIE IR-A starts at 780 nm).
// key: i18n key of the full label; `${key}_S` is the short label used when the band is narrow on screen.

export interface SpectralBand {
  key: string
  lo: number
  hi: number
  color: string // fill
  text: string // label colour (contrast on the fill)
}

export const SPECTRAL_BANDS: SpectralBand[] = [
  { key: 'Band_UVC', lo: 100, hi: 280, color: '#3b1f5c', text: '#ffffff' },
  { key: 'Band_UVB', lo: 280, hi: 315, color: '#5a2d8a', text: '#ffffff' },
  { key: 'Band_UVA', lo: 315, hi: 400, color: '#7e4cc2', text: '#ffffff' },
  { key: 'Band_Blue', lo: 400, hi: 490, color: '#2f63d6', text: '#ffffff' },
  { key: 'Band_Green', lo: 490, hi: 570, color: '#2f9e4f', text: '#ffffff' },
  { key: 'Band_Yellow', lo: 570, hi: 590, color: '#e6cf2e', text: '#2a2400' },
  { key: 'Band_Orange', lo: 590, hi: 620, color: '#f08a24', text: '#2a1400' },
  { key: 'Band_Red', lo: 620, hi: 780, color: '#d23a2a', text: '#ffffff' },
  { key: 'Band_IR', lo: 780, hi: 3000, color: '#5e1b1b', text: '#ffffff' },
]
