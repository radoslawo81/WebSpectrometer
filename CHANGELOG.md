# Changelog

All notable changes of WebSpectrometer2.0. Versions before 2.0.0 were published as the fork `radoslawo81/WebSpectrometer`.

## 2.0.0 – 2026-11-10

Standalone project **WebSpectrometer2.0**, detached from the fork network of jayden-sudo/WebSpectrometer.
- New name, site address and repository: `radoslawo81/WebSpectrometer2.0`
- New README (English and Polish), changelog, history and credits; screenshots from own measurements
- Page metadata, web-app manifest, sitemap and AI-agent description (`llms.txt`) updated for the new project
- About dialog and Help menu point to the new repository
- Documentation languages limited to English and Polish (the app UI keeps its other languages for the base features)

## 1.2.0 – 2026-11-09

- **Higher-order ghosts**: peaks at 2λ / 3λ of a shorter-wavelength peak are flagged as 2nd / 3rd-order ghosts on the graph and in the Lines table instead of being identified as lines; each order can be switched off in the Lines window
- Broad emission peaks (> 8 nm, LEDs) are no longer identified as atomic lines (phosphor bands still allowed)
- **Band bar** under the graph: UVC, UVB, UVA, blue, green, yellow, orange, red, IR (“Bands” toggle)
- **UV-A share** (340–400 nm of 340–780 nm) in the Light quality panel and window
- CCT and CRI reported only for |Duv| ≤ 0.05; coloured, UV and grow lights show “—” with an explanation

## 1.1.0 – 2026-11-09

- **Spectral response calibration with a choice of source**: incandescent (2700 K), halogen 230 V (2900 K), halogen 12 V (3000 K), CIE illuminant A (2856 K), custom temperature, or a reference spectrum loaded from a file (e.g. a solar spectrum, with optional skipping of the O₂/H₂O bands)
- Calibration refused on a saturated spectrum
- Calibration source stored in the calibration file and in saved spectra

## 1.0.0 – 2026-11-07

First release of the fork:
- FWHM, spectrum comparison (total and UV / B / G / R / IR bands)
- Light quality: CCT, Duv, x/y, CRI Ra and R1–R14, luminous efficacy of radiation, illuminance; halogen response calibration and “Corrected” toggle
- Transmission of glasses, filters and windows; absorbance with Beer–Lambert
- Automatic wavelength calibration from reference lamps (CFL, UVC Hg/Ar, Ne, Na, H, He, sunlight)
- Spectral line identification, 2nd-order helper
- Saturation warning, time log, HDR, HTML/PDF report
- Polish interface, modern scientific theme, camera list fix

## Base

Based on [jayden-sudo/WebSpectrometer](https://github.com/jayden-sudo/WebSpectrometer) v1.0.0, a browser port of [Theremino Spectrometer](https://www.theremino.com/en/downloads/automation#spectrometer) V5.0.
