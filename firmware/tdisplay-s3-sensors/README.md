# Sensor firmware – LILYGO T-Display-S3 (AS7331 + AS7265x)

**English** | [Polski](#polski)

One sketch for both sensors, used alone or together:

| Sensor | What it measures | I2C address |
|---|---|---|
| ams OSRAM **AS7331** | UVA / UVB / UVC irradiance, µW/cm² (factory calibration) | 0x74–0x77 |
| ams OSRAM **AS7265x** (SparkFun Spectral Triad) | 18 channels 410–940 nm, ~20 nm wide, µW/cm² (factory calibration) | 0x49 |

The readings are shown on the T-Display-S3 screen and streamed over USB to **WebSpectrometer2.0**: *Tools → UV sensor (AS7331)…* and *Tools → 18-channel spectrometer (AS7265x)…* (one connection serves both windows).

## Wiring

| T-Display-S3 connector | Pins | I2C bus |
|---|---|---|
| Qwiic / STEMMA QT next to USB-C | SDA = GPIO43, SCL = GPIO44 | `Wire` |
| side header | 3V3 / GND / SDA = GPIO18 / SCL = GPIO17 | `Wire1` |

Each sensor can be on either connector; both can also be daisy-chained on the Qwiic connector (the SparkFun boards have two Qwiic ports). Everything is detected automatically. Power the sensors from **3.3 V**.

## Upload (Arduino IDE 2)

1. *Boards Manager*: install **esp32** by Espressif (3.x).
2. *Library Manager*: install **SparkFun AS7331** (also installs *SparkFun Toolkit*), **SparkFun Spectral Triad AS7265X** and **LovyanGFX**.
3. Open `tdisplay-s3-sensors.ino`.
4. *Tools*: Board **LilyGo T-Display-S3** (or *ESP32S3 Dev Module* with Flash 16 MB and PSRAM "OPI PSRAM"), **USB CDC On Boot: Enabled**.
5. Upload. If the port does not appear: hold **BOOT**, press **RST**, release **BOOT**, upload again, then press **RST**.

Without the display (any ESP32-S3 / ESP32 board): set `#define USE_DISPLAY 0`; LovyanGFX is then not needed. On other boards adjust `BUSES`. Both sensor libraries must be installed even if only one sensor is used.

## Use

- **Screens**: AS7331 (UVA / UVB / UVC, log bars) and AS7265x (18 coloured bars, linear to the strongest channel). Button **BOOT (IO0)** switches the screen, **IO14** holds it.
- **Automatic gain** on both sensors; "SATURATED" means the sensor is too close to the source or the gain is fixed too high.
- **AS7265x illumination LEDs** (white, IR, UV) are for reflected-light measurements of samples; keep them off when measuring light sources. The blue status LED is switched off so it does not shine into the sensor.
- In WebSpectrometer2.0 the AS7265x reading can be shown in the main graph or used as the **reference for the spectral response calibration** of the camera spectrometer (smooth-spectrum sources only: halogen, incandescent, sunlight).

## Serial protocol (115200 baud, text lines)

Device → host:
```
#WSUV 1 AS7331 addr=0x74 sda=43 scl=44 gain=16 conv=64 period=500 auto=1
UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flag>
#WSSP 1 AS7265X sda=43 scl=44 gain=16 cycles=50 int=140 auto=1 led=000 nm=410,435,…,940
SP,<ms>,<v410>,<v435>,…,<v940>,<tempC>,<gain>,<intMs>,<flag>      (18 values in wavelength order)
#OK <text>   #ERR <text>
```
Values in µW/cm²; flag `-` ok, `S` saturated, `L` very low signal.

Host → device:
- AS7331: `A` auto gain · `G<n>` gain 1…2048 · `T<ms>` conversion 1…64 ms
- AS7265x: `SA` auto gain · `SG<n>` gain 1, 4 (= 3.7×), 16, 64 · `SN<n>` integration cycles 1…255 (× 2.8 ms) · `SL<W|I|U><0|1>` illumination LED off / on
- both: `P<ms>` period 100…60000 ms · `H` hold display · `I` info lines

## Notes

- Both sensors are broadband (AS7331 channels ±20–50 nm, AS7265x ~20 nm per channel). Narrow lines (LEDs, mercury lines) between or on the edge of channels are measured inaccurately.
- **UVC is dangerous** for eyes and skin: shield germicidal lamps and wear UV-protective glasses. Do not look into the AS7265x UV LED.

---

## Polski

Jeden szkic dla obu czujników, używanych osobno albo razem: **AS7331** (UVA / UVB / UVC w µW/cm², adres 0x74–0x77) i **AS7265x** – SparkFun Spectral Triad (18 kanałów 410–940 nm, ~20 nm każdy, µW/cm², adres 0x49). Odczyty widać na ekranie T-Display-S3 i trafiają przez USB do **WebSpectrometer2.0**: *Narzędzia → Czujnik UV (AS7331)…* oraz *Narzędzia → Spektrometr 18-kanałowy (AS7265x)…* (jedno połączenie obsługuje oba okna).

**Podłączenie:** złącze Qwiic przy USB-C (SDA = GPIO43, SCL = GPIO44) albo piny boczne 3V3 / GND / GPIO18 (SDA) / GPIO17 (SCL). Każdy czujnik może być na dowolnym złączu, oba można też połączyć łańcuchowo przez Qwiic. Wszystko wykrywa się samo. Zasilanie czujników **3,3 V**.

**Wgranie (Arduino IDE 2):**
1. *Boards Manager*: pakiet **esp32** od Espressif (3.x).
2. *Library Manager*: **SparkFun AS7331** (doinstaluje *SparkFun Toolkit*), **SparkFun Spectral Triad AS7265X** i **LovyanGFX**.
3. Otwórz `tdisplay-s3-sensors.ino`.
4. *Tools*: płytka **LilyGo T-Display-S3** (albo *ESP32S3 Dev Module*, Flash 16 MB, PSRAM „OPI PSRAM”), **USB CDC On Boot: Enabled**.
5. Wgraj. Gdy port się nie pojawia: przytrzymaj **BOOT**, naciśnij **RST**, puść **BOOT**, wgraj ponownie i naciśnij **RST**.

Obie biblioteki czujników muszą być zainstalowane, nawet gdy używasz tylko jednego. Bez wyświetlacza: `#define USE_DISPLAY 0`.

**Użycie:** dwa ekrany – AS7331 (UVA / UVB / UVC) i AS7265x (18 kolorowych słupków); przycisk **BOOT (IO0)** przełącza ekran, **IO14** zatrzymuje odczyt. Wzmocnienie dobiera się automatycznie. Diody oświetlające AS7265x (biała, IR, UV) służą do pomiaru światła odbitego od próbek – przy pomiarze źródeł światła trzymaj je wyłączone; niebieska dioda stanu jest wyłączana, żeby nie świeciła w czujnik. W programie odczyt AS7265x można pokazać na głównym wykresie albo użyć jako **wzorca do kalibracji czułości** spektrometru z kamerą (tylko źródła o gładkim widmie: halogen, żarówka, Słońce).

**Uwagi:** oba czujniki są szerokopasmowe, więc wąskie linie (diody, linie rtęci) między kanałami albo na ich zboczach mierzą niedokładnie. **UVC jest groźne** dla oczu i skóry: osłaniaj lampy bakteriobójcze, używaj okularów chroniących przed UV i nie patrz w diodę UV płytki AS7265x.
