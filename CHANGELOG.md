# Changelog

All notable changes of WebSpectrometer2.0. Versions before 2.0.0 were published as the fork `radoslawo81/WebSpectrometer`.

## 2.5.2 – 2026-11-14

- Firmware: combined screen with both sensors (UVA / UVB / UVC values on top, 18 triad bars below), shown first when both are connected; BOOT cycles combined → UV → triad

## 2.5.1 – 2026-11-14

- Firmware: the AS7331 is re-initialised automatically when it returns all zeros with −66.9 °C (it lost its settings after a supply dip and stayed in configuration mode); if that does not help, it is searched for again every 3 s

## 2.5.0 – 2026-11-14

- **AS7265x channel correction** (*Sensors → Calibrate triad with a bulb*): one measurement of a clear incandescent bulb of known colour temperature gives a factor Planck(λ, T) / reading for each of the 18 channels; stored in the browser and applied to all new readings (chart, overlay, main graph, CSV, report). Corrects the factory calibration, which was off by up to 2–3× per channel on the tested board
- Firmware: invalid calibrated triad values (damaged 4-byte float reads: NaN, negative, absurd) are read again and otherwise rebuilt from the raw counts with the channel's last good ratio, instead of being shown as 0; the number of repaired reads is reported to the app

## 2.4.0 – 2026-11-14

- **Live sensor overlay on the main graph**: the current AS7331 UV bands and AS7265x channels drawn as translucent bars over their pass bands, together with the live camera spectrum; scale fitted to the camera curve (least squares) or to the graph maximum
- Sensors window wider, bar chart with one equal-width bar per channel, datasheet peak wavelength and channel letter (A…L) under every bar, value above every bar, value grid

## 2.3.0 – 2026-11-14

- **One Sensors window** (*Tools → Sensors (AS7331 UV + AS7265x)…*) replaces the separate UV and triad windows: combined bar chart 240–960 nm (UVA / UVB / UVC bands next to the 18 triad channels), optional per-nm scale so the wide UV bands and the 20 nm triad channels compare, UV values with min / mean / max and trend, controls of both sensors, both CSV logs
- **Show in the main graph** can include the three UV bands (AS7331) together with the triad channels
- Firmware: the display refreshes on its own clock (it no longer depends on the measurement loop or on a host reading the USB port), USB writes cannot block the loop, debounced buttons (no false HOLD at start-up), the triad line is sent in one piece

## 2.2.0 – 2026-11-14

- **18-channel spectrometer (AS7265x)** window (*Tools → 18-channel spectrometer (AS7265x)…*) for the SparkFun Spectral Triad: bar chart on a wavelength axis (linear / log), table of values, gain / integration time / illumination LED control, CSV log
- **Show in the main graph**: the averaged 18-channel spectrum, interpolated to 1 nm, can be loaded into the main graph for light-quality analysis
- **Spectral response calibration with the AS7265x**: the averaged triad reading is used as the reference spectrum for the camera spectrometer (smooth-spectrum sources)
- One serial connection serves both sensor windows; the AS7265x reading is written to saved spectra (`AS7265x` header line) and to the report
- **Firmware renamed to `firmware/tdisplay-s3-sensors`** and extended: AS7331 and/or AS7265x on either I2C connector (two buses, `Wire` on the Qwiic connector, `Wire1` on the side header), automatic gain for both, two screens switched with the BOOT button, AS7265x status LED switched off
- Firmware fix (since 2.1.0): AS7331 gain / conversion time written in configuration mode, init diagnostics on screen and over USB

## 2.1.0 – 2026-11-14

- **UV sensor (AS7331)** window (*Tools → UV sensor (AS7331)…*): Web Serial connection, live UVA / UVB / UVC in µW/cm² with automatic units, min / mean / max since reset, trend per channel, gain / conversion time / period control, CSV log, comparison with the spectrometer's UV-A share; the connection keeps logging when the window is closed
- The last UV sensor reading is written to saved spectrum files (`UVSensor` header line) and to the HTML report
- **Firmware** for the LILYGO T-Display-S3 + AS7331 (`firmware/as7331-tdisplay-s3`): automatic I2C pin and address detection, automatic gain, on-screen readout, simple text protocol

## 2.0.0 – 2026-11-10

Standalone project **WebSpectrometer2.0**, detached from the fork network of jayden-sudo/WebSpectrometer.
- New name, site address and repository: `radoslawo81/WebSpectrometer2.0`
- New README (English and Polish), changelog, history and credits; screenshots from own measurements
- Page metadata, web-app manifest, sitemap and AI-agent description (`llms.txt`) updated for the new project
- About dialog and Help menu point to the new repository
- English and Polish only: the Chinese (simplified and traditional), Italian, French and Portuguese interface and README translations of the base project were removed; a language saved by an older version falls back to the browser language

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
