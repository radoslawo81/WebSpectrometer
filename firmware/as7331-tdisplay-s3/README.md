# AS7331 UV sensor firmware – LILYGO T-Display-S3

**English** | [Polski](#polski)

Reads the ams OSRAM **AS7331** (UVA / UVB / UVC, factory-calibrated in µW/cm²), shows the three channels on the T-Display-S3 screen and streams them over USB to **WebSpectrometer2.0** (*Tools → UV sensor (AS7331)…*).

## Wiring

| AS7331 breakout | T-Display-S3 |
|---|---|
| Qwiic / STEMMA QT cable | Qwiic connector next to USB-C (SDA = GPIO43, SCL = GPIO44) |
| or VIN / GND / SDA / SCL | 3V3 / GND / GPIO18 / GPIO17 (side header) |

Both pin pairs and the I2C addresses 0x74–0x77 are detected automatically. Power the sensor from **3.3 V**.

## Upload (Arduino IDE 2)

1. *Boards Manager*: install **esp32** by Espressif (3.x).
2. *Library Manager*: install **SparkFun AS7331** (it also installs *SparkFun Toolkit*) and **LovyanGFX**.
3. Open `as7331-tdisplay-s3.ino`.
4. *Tools*: Board **LilyGo T-Display-S3** (or *ESP32S3 Dev Module* with Flash 16 MB and PSRAM "OPI PSRAM"), **USB CDC On Boot: Enabled**.
5. Upload. If the port does not appear: hold **BOOT**, press **RST**, release **BOOT**, upload again, then press **RST**.

Without the display (any ESP32-S3 / ESP32 board): set `#define USE_DISPLAY 0`; LovyanGFX is then not needed. On other boards adjust `I2C_PINS`.

## Use

- Screen: UVA / UVB / UVC with automatic units, log bar, gain, conversion time, temperature. Button **IO14** = hold the display.
- WebSpectrometer2.0: *Tools → UV sensor (AS7331)… → Connect*, choose the board's port. Live values, min / mean / max, trend, CSV log; the last reading is added to saved spectra and to the report.
- Automatic gain keeps the strongest channel between ~2 % and ~85 % of full scale; "SATURATED" means the sensor is too close or the gain is fixed too high.

## Serial protocol (115200 baud, text lines)

Device → host:
```
#WSUV 1 AS7331 addr=0x74 sda=43 scl=44 gain=16 conv=64 period=250 auto=1
UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flag>     µW/cm², flag - / S (saturated) / L (low)
#OK <text>   #ERR <text>
```
Host → device: `A` auto gain · `G<n>` gain 1…2048 · `T<ms>` conversion 1…64 ms · `P<ms>` period 50…60000 ms · `H` hold · `I` info.

Any other device that prints the same `UV,…` lines works with WebSpectrometer2.0.

## Notes

- The channels are broadband (UVA ~360 ± 50 nm, UVB ~300 ± 20 nm, UVC ~260 ± 20 nm). For narrow sources on the edge of a channel (UV LEDs, mercury lines) the factory calibration can be off by tens of percent.
- **UVC is dangerous** for eyes and skin: shield germicidal lamps and wear UV-protective glasses.

---

## Polski

Firmware czyta czujnik **AS7331** (UVA / UVB / UVC, skalibrowany fabrycznie w µW/cm²), pokazuje trzy kanały na ekranie T-Display-S3 i wysyła je przez USB do **WebSpectrometer2.0** (*Narzędzia → Czujnik UV (AS7331)…*).

**Podłączenie:** przewód Qwiic do złącza obok USB-C (SDA = GPIO43, SCL = GPIO44) albo piny boczne 3V3 / GND / GPIO18 (SDA) / GPIO17 (SCL). Piny i adres I2C (0x74–0x77) są wykrywane automatycznie. Zasilanie czujnika **3,3 V**.

**Wgranie (Arduino IDE 2):**
1. *Boards Manager*: pakiet **esp32** od Espressif (3.x).
2. *Library Manager*: **SparkFun AS7331** (doinstaluje *SparkFun Toolkit*) i **LovyanGFX**.
3. Otwórz `as7331-tdisplay-s3.ino`.
4. *Tools*: płytka **LilyGo T-Display-S3** (albo *ESP32S3 Dev Module*, Flash 16 MB, PSRAM „OPI PSRAM”), **USB CDC On Boot: Enabled**.
5. Wgraj. Gdy port się nie pojawia: przytrzymaj **BOOT**, naciśnij **RST**, puść **BOOT**, wgraj ponownie i naciśnij **RST**.

Bez wyświetlacza (dowolne ESP32): `#define USE_DISPLAY 0`, LovyanGFX niepotrzebny. Na innych płytkach popraw `I2C_PINS`.

**Użycie:** na ekranie UVA / UVB / UVC z automatycznymi jednostkami; przycisk **IO14** zatrzymuje odczyt na ekranie. W programie: *Narzędzia → Czujnik UV (AS7331)… → Połącz* i wybierz port płytki. Automatyczne wzmocnienie trzyma najsilniejszy kanał w zakresie ~2–85 % pełnej skali; „SATURATED” oznacza, że czujnik jest za blisko źródła albo wzmocnienie ustawione ręcznie jest za duże.

**Uwagi:** kanały są szerokopasmowe, więc dla wąskich źródeł na zboczu kanału (diody UV, linie rtęci) wynik może odbiegać o kilkadziesiąt procent. **UVC jest groźne** dla oczu i skóry: osłaniaj lampy bakteriobójcze i używaj okularów chroniących przed UV.
