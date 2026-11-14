/*
  WebSpectrometer2.0 – sensor firmware for the LILYGO T-Display-S3

  Supported sensors (either or both, on any of the two I2C connectors):
    - ams OSRAM AS7331      – UVA / UVB / UVC irradiance (µW/cm², factory calibration), address 0x74…0x77
    - ams OSRAM AS7265x     – SparkFun Spectral Triad, 18 channels 410…940 nm (µW/cm², factory calibration), address 0x49

  The readings are shown on the built-in display and streamed over USB to WebSpectrometer2.0
  (Tools → UV sensor (AS7331)… and Tools → 18-channel spectrometer (AS7265x)…).

  Hardware
    - LILYGO T-Display-S3 (ESP32-S3R8, ST7789 170×320 parallel display)
    - Qwiic / STEMMA QT connector next to USB-C: SDA = GPIO43, SCL = GPIO44   (I2C bus "Wire")
    - side header: SDA = GPIO18, SCL = GPIO17                                 (I2C bus "Wire1")
      Both buses are scanned; daisy-chaining both sensors on the Qwiic connector works too.
    - Buttons: IO14 = hold the display, BOOT (IO0) = switch screen (UV / spectral triad)

  Arduino IDE
    - Board package: "esp32" by Espressif (3.x)
    - Board: "LilyGo T-Display-S3" (or "ESP32S3 Dev Module" with Flash 16 MB, PSRAM "OPI PSRAM")
    - Tools → USB CDC On Boot → "Enabled"   (otherwise nothing arrives over USB-C)
    - Libraries (Library Manager): "SparkFun AS7331" (installs "SparkFun Toolkit"),
      "SparkFun Spectral Triad AS7265X", "LovyanGFX"
      Without a display set USE_DISPLAY to 0 – LovyanGFX is then not needed.
    - Upload problems: hold BOOT, press RST, release BOOT, upload again.

  Serial protocol (115200 8N1 – the baud rate is ignored by USB CDC), one line per message
    Device → host
      #WSUV 1 AS7331 addr=0x74 sda=43 scl=44 gain=16 conv=64 period=500 auto=1
      UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flag>
      #WSSP 1 AS7265X sda=43 scl=44 gain=16 cycles=50 int=140 auto=1 led=000 nm=410,435,…,940
      SP,<ms>,<v410>,<v435>,…,<v940>,<tempC>,<gain>,<intMs>,<flag>        (18 values, wavelength order)
          values in µW/cm²; flag '-' ok, 'S' near full scale (saturated), 'L' very low signal
      #OK <text>   #ERR <text>
    Host → device
      AS7331:  A (auto gain) · G<n> (gain 1…2048) · T<ms> (conversion 1…64 ms)
      AS7265x: SA (auto gain) · SG<n> (gain 1, 4 (=3.7×), 16, 64) · SN<n> (integration cycles 1…255, ×2.8 ms)
               SL<W|I|U><0|1> (white / IR / UV illumination LED off/on)
      both:    P<ms> (period 100…60000 ms) · H (hold display) · I (info lines)

  License: GNU GPL v3 (part of WebSpectrometer2.0, https://github.com/radoslawo81/WebSpectrometer2.0)
*/

#include <Arduino.h>
#include <Wire.h>
#include <SparkFun_AS7331.h>
#include <SparkFun_AS7265X.h>

#define USE_DISPLAY 1

// ---------------------------------------------------------------------------------------------
// Board
static const int PIN_POWER_ON = 15; // must be HIGH for the display when running from battery
static const int PIN_BUTTON_HOLD = 14;
static const int PIN_BUTTON_SCREEN = 0; // BOOT button, usable after start-up
struct I2cBus {
  TwoWire *wire;
  int sda, scl;
};
static I2cBus BUSES[2] = {{&Wire, 43, 44}, {&Wire1, 18, 17}};

uint32_t periodMs = 500;
bool hold = false;

bool probe(TwoWire &w, uint8_t addr) {
  w.beginTransmission(addr);
  return w.endTransmission() == 0;
}

// =============================================================================================
// AS7331 – UVA / UVB / UVC
// Full-scale irradiance at gain 1× (µW/cm²) for UVA, UVB, UVC. For conversion times ≤ 64 ms the full
// scale depends on the gain only (a shorter time lowers the resolution, not the range).
static const float UV_FS_GAIN1[3] = {349000.0f, 386000.0f, 169000.0f};
static const as7331_gain_t UV_GAINS[] = {GAIN_1, GAIN_2, GAIN_4, GAIN_8, GAIN_16, GAIN_32,
                                         GAIN_64, GAIN_128, GAIN_256, GAIN_512, GAIN_1024, GAIN_2048};
static const uint16_t UV_GAIN_VALUES[] = {1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048};
static const int UV_N_GAINS = 12;
static const as7331_conv_time_t UV_TIMES[] = {TIME_1MS, TIME_2MS, TIME_4MS, TIME_8MS, TIME_16MS, TIME_32MS, TIME_64MS};
static const uint16_t UV_TIME_VALUES[] = {1, 2, 4, 8, 16, 32, 64};
static const int UV_N_TIMES = 7;

SfeAS7331ArdI2C uv;
bool uvOk = false;
const I2cBus *uvBus = nullptr;
uint8_t uvAddr = 0;
uint8_t uvProbedAddr = 0;      // an I2C device answered at 0x74-0x77 (even if the init failed)
const char *uvError = "";      // which init step failed
int uvGainIdx = 4;             // 16×
int uvTimeIdx = 6;             // 64 ms
bool uvAuto = true;
float uvLast[3] = {0, 0, 0};
float uvTemp = NAN;
char uvFlag = '-';

float uvFullScale(int ch) { return UV_FS_GAIN1[ch] / UV_GAIN_VALUES[uvGainIdx]; }

void uvPrintInfo() {
  if (!uvOk) return;
  Serial.printf("#WSUV 1 AS7331 addr=0x%02X sda=%d scl=%d gain=%u conv=%u period=%lu auto=%d\n", uvAddr, uvBus->sda, uvBus->scl,
                UV_GAIN_VALUES[uvGainIdx], UV_TIME_VALUES[uvTimeIdx], (unsigned long)periodMs, uvAuto ? 1 : 0);
}

// Gain and conversion time can only be written in configuration mode: switch to it, write the
// registers, then return to one-shot measurement mode (CMD)
bool uvApplySettings() {
  if (uv.setOperationMode(DEVICE_MODE_CFG) != ksfTkErrOk) return (uvError = "config mode", false);
  if (uv.setGain(UV_GAINS[uvGainIdx]) != ksfTkErrOk) return (uvError = "set gain", false);
  if (uv.setConversionTime(UV_TIMES[uvTimeIdx]) != ksfTkErrOk) return (uvError = "set conversion time", false);
  if (!uv.prepareMeasurement(MEAS_MODE_CMD)) return (uvError = "measurement mode", false);
  return true;
}

bool uvInit() {
  uvProbedAddr = 0;
  uvError = "no I2C device at 0x74-0x77";
  for (auto &b : BUSES) {
    for (uint8_t a = 0x74; a <= 0x77; a++) {
      if (!probe(*b.wire, a)) continue;
      uvProbedAddr = a;
      uvBus = &b;
      if (!uv.begin(a, *b.wire)) {
        uvError = "device answers but is not an AS7331 (ID)";
        Serial.printf("#ERR I2C device at 0x%02X (SDA %d / SCL %d) is not an AS7331\n", a, b.sda, b.scl);
        continue;
      }
      uvAddr = a;
      if (!uvApplySettings()) {
        Serial.printf("#ERR AS7331 at 0x%02X: init failed (%s)\n", a, uvError);
        return false;
      }
      uvError = "";
      return true;
    }
  }
  return false;
}

bool uvMeasureOnce() {
  if (uv.setStartState(true) != ksfTkErrOk) return false;
  delay(2 + uv.getConversionTimeMillis());
  if (uv.readAllUV() != ksfTkErrOk) return false;
  uvLast[0] = uv.getUVA();
  uvLast[1] = uv.getUVB();
  uvLast[2] = uv.getUVC();
  if (uv.readTemp() == ksfTkErrOk) uvTemp = uv.getTemp();
  return true;
}

// A measurement that never ran reads all zeros with a temperature of −66.9 °C (raw 0). That is what
// the AS7331 returns after it lost its settings (a supply dip resets it to configuration mode, e.g.
// when another sensor or LED on the bus switches on). Then the settings are written again.
bool uvLooksDead() { return uvLast[0] == 0.0f && uvLast[1] == 0.0f && uvLast[2] == 0.0f && uvTemp < -60.0f; }

bool uvMeasure() {
  if (!uvMeasureOnce()) return false;
  if (!uvLooksDead()) return true;
  Serial.println("#ERR AS7331 lost its settings (all zero) - re-initialising");
  if (!uv.begin(uvAddr, *uvBus->wire) || !uvApplySettings()) return false;
  if (!uvMeasureOnce()) return false;
  return !uvLooksDead();
}

// Automatic gain: keep the strongest channel between ~2 % and ~85 % of full scale
void uvAutoRange(float r) {
  if (!uvAuto) return;
  int target = uvGainIdx;
  if (r > 0.85f && uvGainIdx > 0) {
    target = uvGainIdx - (r > 0.98f ? 3 : 1);
  } else if (r < 0.02f && uvGainIdx < UV_N_GAINS - 1) {
    float wanted = UV_GAIN_VALUES[uvGainIdx] * 0.4f / max(r, 1e-6f);
    while (target < UV_N_GAINS - 1 && UV_GAIN_VALUES[target + 1] <= wanted) target++;
  }
  target = constrain(target, 0, UV_N_GAINS - 1);
  if (target != uvGainIdx) {
    uvGainIdx = target;
    uvApplySettings();
  }
}

void uvStep(uint32_t now) {
  if (!uvMeasure()) {
    Serial.println("#ERR AS7331 measurement failed");
    uvOk = false;
    return;
  }
  float r = 0;
  for (int c = 0; c < 3; c++) r = max(r, uvLast[c] / uvFullScale(c));
  uvFlag = r > 0.9f ? 'S' : (r < 0.0005f && uvGainIdx == UV_N_GAINS - 1 ? 'L' : '-');
  Serial.printf("UV,%lu,%.4f,%.4f,%.4f,%.2f,%u,%u,%c\n", (unsigned long)now, uvLast[0], uvLast[1], uvLast[2],
                isnan(uvTemp) ? 0.0f : uvTemp, UV_GAIN_VALUES[uvGainIdx], UV_TIME_VALUES[uvTimeIdx], uvFlag);
  uvAutoRange(r);
}

// =============================================================================================
// AS7265x – SparkFun Spectral Triad, 18 channels
static const uint16_t SP_NM[18] = {410, 435, 460, 485, 510, 535, 560, 585, 610, 645, 680, 705, 730, 760, 810, 860, 900, 940};
static const uint8_t SP_GAINS[4] = {AS7265X_GAIN_1X, AS7265X_GAIN_37X, AS7265X_GAIN_16X, AS7265X_GAIN_64X};
static const float SP_GAIN_VALUES[4] = {1.0f, 3.7f, 16.0f, 64.0f};

AS7265X triad;
bool spOk = false;
const I2cBus *spBus = nullptr;
int spGainIdx = 2;     // 16×
uint8_t spCycles = 50; // × 2.8 ms = 140 ms
bool spAuto = true;
bool spLed[3] = {false, false, false}; // white, IR, UV
float spLast[18];
uint16_t spRawMax = 0;
float spTemp = NAN;
char spFlag = '-';

float spRatio[18];     // last good calibrated/raw ratio per channel (0 = unknown); reset on gain / time change
uint32_t spFixed = 0;  // number of values rebuilt from raw counts (reported in the info line)

float spIntMs() { return spCycles * 2.8f; }

void spPrintInfo() {
  if (!spOk) return;
  Serial.printf("#WSSP 1 AS7265X sda=%d scl=%d gain=%g cycles=%u int=%.0f auto=%d led=%d%d%d nm=", spBus->sda, spBus->scl,
                SP_GAIN_VALUES[spGainIdx], spCycles, spIntMs(), spAuto ? 1 : 0, spLed[0], spLed[1], spLed[2]);
  for (int i = 0; i < 18; i++) Serial.printf(i ? ",%u" : "%u", SP_NM[i]);
  Serial.printf(" fixed=%lu\n", (unsigned long)spFixed);
}

void spApplySettings() {
  triad.setGain(SP_GAINS[spGainIdx]);
  triad.setIntegrationCycles(spCycles);
  for (auto &r : spRatio) r = 0; // the cal/raw ratio depends on gain and integration time
}

void spApplyLeds() {
  const uint8_t ids[3] = {AS7265x_LED_WHITE, AS7265x_LED_IR, AS7265x_LED_UV};
  for (int i = 0; i < 3; i++) {
    if (spLed[i]) triad.enableBulb(ids[i]);
    else triad.disableBulb(ids[i]);
  }
}

bool spInit() {
  for (auto &b : BUSES) {
    if (!probe(*b.wire, 0x49)) continue;
    if (!triad.begin(*b.wire)) {
      Serial.printf("#ERR device at 0x49 (SDA %d / SCL %d) did not start as AS7265x\n", b.sda, b.scl);
      continue;
    }
    spBus = &b;
    triad.disableIndicator(); // the blue status LED would shine into the sensor
    spApplySettings();
    spApplyLeds();
    return true;
  }
  return false;
}

// The calibrated values are 4-byte floats read over the AS7265x virtual-register I2C protocol;
// a disturbed transfer gives garbage (NaN, negative, absurd). Such a value is read again, and if
// it is still invalid it is rebuilt from the channel's raw counts with the last good cal/raw ratio.
float spReadCal(int i) {
  switch (i) {
    case 0: return triad.getCalibratedA();
    case 1: return triad.getCalibratedB();
    case 2: return triad.getCalibratedC();
    case 3: return triad.getCalibratedD();
    case 4: return triad.getCalibratedE();
    case 5: return triad.getCalibratedF();
    case 6: return triad.getCalibratedG();
    case 7: return triad.getCalibratedH();
    case 8: return triad.getCalibratedR();
    case 9: return triad.getCalibratedI();
    case 10: return triad.getCalibratedS();
    case 11: return triad.getCalibratedJ();
    case 12: return triad.getCalibratedT();
    case 13: return triad.getCalibratedU();
    case 14: return triad.getCalibratedV();
    case 15: return triad.getCalibratedW();
    case 16: return triad.getCalibratedK();
    default: return triad.getCalibratedL();
  }
}

uint16_t spReadRaw(int i) {
  switch (i) {
    case 0: return triad.getA();
    case 1: return triad.getB();
    case 2: return triad.getC();
    case 3: return triad.getD();
    case 4: return triad.getE();
    case 5: return triad.getF();
    case 6: return triad.getG();
    case 7: return triad.getH();
    case 8: return triad.getR();
    case 9: return triad.getI();
    case 10: return triad.getS();
    case 11: return triad.getJ();
    case 12: return triad.getT();
    case 13: return triad.getU();
    case 14: return triad.getV();
    case 15: return triad.getW();
    case 16: return triad.getK();
    default: return triad.getL();
  }
}

bool spCalValid(float v) { return isfinite(v) && v >= 0.0f && v < 1.0e7f; }

void spMeasure() {
  triad.takeMeasurements(); // one-shot of all 18 channels (waits for the data)
  spRawMax = 0;
  for (int i = 0; i < 18; i++) {
    uint16_t raw = spReadRaw(i);
    if (raw > spRawMax) spRawMax = raw;
    float cal = spReadCal(i);
    // Invalid, or wildly off the channel's usual cal/raw ratio: read once more
    bool off = spRatio[i] > 0 && raw > 50 && (cal < 0.2f * spRatio[i] * raw || cal > 5.0f * spRatio[i] * raw);
    if (!spCalValid(cal) || off) {
      cal = spReadCal(i);
      off = spRatio[i] > 0 && raw > 50 && (cal < 0.2f * spRatio[i] * raw || cal > 5.0f * spRatio[i] * raw);
    }
    if (spCalValid(cal) && !off) {
      if (raw > 50) spRatio[i] = spRatio[i] > 0 ? 0.8f * spRatio[i] + 0.2f * cal / raw : cal / raw;
    } else {
      cal = spRatio[i] > 0 ? spRatio[i] * raw : 0.0f;
      spFixed++;
    }
    spLast[i] = cal;
  }
  spTemp = triad.getTemperatureAverage();
}

// Automatic gain on the raw 16-bit counts: one step at a time, 60000 / 1500 thresholds
void spAutoRange() {
  if (!spAuto) return;
  int target = spGainIdx;
  if (spRawMax > 60000 && spGainIdx > 0) target--;
  else if (spRawMax < 1500 && spGainIdx < 3) target++;
  if (target != spGainIdx) {
    spGainIdx = target;
    spApplySettings();
  }
}

void spStep(uint32_t now) {
  spMeasure();
  spFlag = spRawMax > 60000 ? 'S' : (spRawMax < 200 && spGainIdx == 3 ? 'L' : '-');
  // Build the whole line first and send it with one write (no half lines on a busy link)
  char buf[320];
  int n = snprintf(buf, sizeof buf, "SP,%lu", (unsigned long)now);
  for (int i = 0; i < 18; i++) n += snprintf(buf + n, sizeof buf - n, ",%.3f", spLast[i]);
  snprintf(buf + n, sizeof buf - n, ",%.1f,%g,%.0f,%c\n", isnan(spTemp) ? 0.0f : spTemp, SP_GAIN_VALUES[spGainIdx], spIntMs(), spFlag);
  Serial.print(buf);
  spAutoRange();
  // Tell the host about repaired reads (at most every 5 s)
  static uint32_t reportedFixed = 0, reportedAt = 0;
  if (spFixed != reportedFixed && now - reportedAt > 5000) {
    reportedFixed = spFixed;
    reportedAt = now;
    spPrintInfo();
  }
}

// =============================================================================================
// Display
#if USE_DISPLAY
#define LGFX_USE_V1
#include <LovyanGFX.hpp>

class LGFX_TDisplayS3 : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789 panel;
  lgfx::Bus_Parallel8 bus;
  lgfx::Light_PWM light;

 public:
  LGFX_TDisplayS3() {
    {
      auto cfg = bus.config();
      cfg.freq_write = 20000000;
      cfg.pin_wr = 8;
      cfg.pin_rd = 9;
      cfg.pin_rs = 7; // D/C
      cfg.pin_d0 = 39;
      cfg.pin_d1 = 40;
      cfg.pin_d2 = 41;
      cfg.pin_d3 = 42;
      cfg.pin_d4 = 45;
      cfg.pin_d5 = 46;
      cfg.pin_d6 = 47;
      cfg.pin_d7 = 48;
      bus.config(cfg);
      panel.setBus(&bus);
    }
    {
      auto cfg = panel.config();
      cfg.pin_cs = 6;
      cfg.pin_rst = 5;
      cfg.pin_busy = -1;
      cfg.panel_width = 170;
      cfg.panel_height = 320;
      cfg.offset_x = 35;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.readable = false;
      cfg.invert = true;
      cfg.rgb_order = false;
      cfg.dlen_16bit = false;
      cfg.bus_shared = false;
      panel.config(cfg);
    }
    {
      auto cfg = light.config();
      cfg.pin_bl = 38;
      cfg.invert = false;
      cfg.freq = 22000;
      cfg.pwm_channel = 7;
      light.config(cfg);
      panel.setLight(&light);
    }
    setPanel(&panel);
  }
};

LGFX_TDisplayS3 lcd;
LGFX_Sprite canvas(&lcd);
bool canvasOk = false;
int screen = 0; // 0 = AS7331, 1 = AS7265x

static const uint16_t COL_BG = 0x0841;
static const uint16_t COL_TXT = 0xEF7D;
static const uint16_t COL_MUTED = 0x8C71;
static const uint16_t COL_CH[3] = {0xA81F, 0x681F, 0x380F};

// Approximate colour of a wavelength (RGB565); near IR shown dark red
uint16_t nmColor(float nm) {
  float r = 0, g = 0, b = 0;
  if (nm < 440) r = (440 - nm) / 60, b = 1;
  else if (nm < 490) g = (nm - 440) / 50, b = 1;
  else if (nm < 510) g = 1, b = (510 - nm) / 20;
  else if (nm < 580) r = (nm - 510) / 70, g = 1;
  else if (nm < 645) r = 1, g = (645 - nm) / 65;
  else if (nm < 700) r = 1;
  else r = max(0.35f, 1.0f - (nm - 700) / 300);
  return lcd.color565((uint8_t)(255 * constrain(r, 0.0f, 1.0f)), (uint8_t)(255 * constrain(g, 0.0f, 1.0f)),
                      (uint8_t)(255 * constrain(b, 0.0f, 1.0f)));
}

void formatIrr(float uw, char *val, char *unit) {
  if (uw >= 1000.0f) {
    snprintf(val, 16, uw >= 100000.0f ? "%.0f" : uw >= 10000.0f ? "%.1f" : "%.2f", uw / 1000.0f);
    strcpy(unit, "mW/cm2");
  } else {
    snprintf(val, 16, uw >= 100.0f ? "%.1f" : uw >= 1.0f ? "%.2f" : "%.3f", uw);
    strcpy(unit, "uW/cm2");
  }
}

void drawHeader(const char *title) {
  canvas.fillScreen(COL_BG);
  canvas.setTextDatum(textdatum_t::top_left);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(COL_TXT, COL_BG);
  canvas.drawString(title, 8, 4);
  canvas.setTextColor(COL_MUTED, COL_BG);
  canvas.setTextDatum(textdatum_t::top_right);
  canvas.drawString(hold ? "HOLD" : (Serial ? "USB" : ""), 312, 4);
}

void drawNoSensor() {
  drawHeader("WebSpectrometer2.0 sensors");
  canvas.setTextDatum(textdatum_t::middle_center);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(0xF800, COL_BG);
  char l1[56];
  if (uvProbedAddr) snprintf(l1, sizeof l1, "AS7331 0x%02X: %s", uvProbedAddr, uvError);
  else snprintf(l1, sizeof l1, "no AS7331 / AS7265x found");
  canvas.drawString(l1, 160, 60);
  canvas.setTextColor(COL_MUTED, COL_BG);
  canvas.drawString("Qwiic: SDA 43 / SCL 44", 160, 95);
  canvas.drawString("header: SDA 18 / SCL 17", 160, 115);
}

void drawUv() {
  drawHeader("AS7331  UV");
  const char *names[3] = {"UVA", "UVB", "UVC"};
  for (int c = 0; c < 3; c++) {
    int y = 26 + c * 42;
    canvas.fillRoundRect(8, y + 2, 46, 30, 6, COL_CH[c]);
    canvas.setTextDatum(textdatum_t::middle_center);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(TFT_WHITE, COL_CH[c]);
    canvas.drawString(names[c], 31, y + 17);
    char val[16], unit[8];
    formatIrr(uvLast[c], val, unit);
    canvas.setTextDatum(textdatum_t::middle_right);
    canvas.setFont(&fonts::Font4);
    canvas.setTextColor(COL_TXT, COL_BG);
    canvas.drawString(val, 196, y + 17);
    canvas.setTextDatum(textdatum_t::middle_left);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(COL_MUTED, COL_BG);
    canvas.drawString(unit, 202, y + 17);
    float fs = uvFullScale(c);
    float frac = uvLast[c] > 0.01f ? log10f(uvLast[c] / 0.01f) / log10f(fs / 0.01f) : 0;
    frac = constrain(frac, 0.0f, 1.0f);
    canvas.drawRect(262, y + 8, 50, 18, COL_MUTED);
    canvas.fillRect(263, y + 9, (int)(48 * frac), 16, uvLast[c] / fs > 0.9f ? 0xF800 : COL_CH[c]);
  }
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(textdatum_t::bottom_left);
  canvas.setTextColor(COL_MUTED, COL_BG);
  char foot[64];
  snprintf(foot, sizeof foot, "gain %u%s  %u ms  %.1f C", UV_GAIN_VALUES[uvGainIdx], uvAuto ? " auto" : "",
           UV_TIME_VALUES[uvTimeIdx], isnan(uvTemp) ? 0.0f : uvTemp);
  canvas.drawString(foot, 8, 166);
  if (uvFlag == 'S') {
    canvas.setTextDatum(textdatum_t::bottom_right);
    canvas.setTextColor(0xF800, COL_BG);
    canvas.drawString("SATURATED", 312, 166);
  }
}

// 18 bars, linear scale to the strongest channel
void drawTriad() {
  drawHeader("AS7265x  410-940 nm");
  float vmax = 0;
  int imax = 0;
  for (int i = 0; i < 18; i++)
    if (spLast[i] > vmax) vmax = spLast[i], imax = i;
  const int x0 = 8, w = 17, base = 140, hmax = 106;
  for (int i = 0; i < 18; i++) {
    int h = vmax > 0 ? (int)(hmax * spLast[i] / vmax) : 0;
    canvas.fillRect(x0 + i * w, base - h, w - 3, h, nmColor(SP_NM[i]));
  }
  canvas.drawFastHLine(x0, base + 1, 18 * w - 3, COL_MUTED);
  canvas.setFont(&fonts::Font0);
  canvas.setTextColor(COL_MUTED, COL_BG);
  canvas.setTextDatum(textdatum_t::top_center);
  for (int i = 0; i < 18; i += 3) {
    char lab[6];
    snprintf(lab, sizeof lab, "%u", SP_NM[i]);
    canvas.drawString(lab, x0 + i * w + (w - 3) / 2, base + 4);
  }
  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(textdatum_t::bottom_left);
  char foot[72], val[16], unit[8];
  formatIrr(vmax, val, unit);
  snprintf(foot, sizeof foot, "max %s %s @%u  g%g%s %.0fms", val, unit, SP_NM[imax], SP_GAIN_VALUES[spGainIdx],
           spAuto ? "a" : "", spIntMs());
  canvas.drawString(foot, 8, 168);
  if (spFlag == 'S') {
    canvas.setTextDatum(textdatum_t::top_right);
    canvas.setTextColor(0xF800, COL_BG);
    canvas.drawString("SATURATED", 312, 22);
  }
}

void drawScreen() {
  if (!canvasOk) return;
  if (!uvOk && !spOk) drawNoSensor();
  else if (screen == 1 && spOk) drawTriad();
  else if (uvOk) drawUv();
  else drawTriad();
  canvas.pushSprite(0, 0);
}
#endif

// =============================================================================================
// Commands
void printInfo() {
  uvPrintInfo();
  spPrintInfo();
  if (!uvOk && !spOk) Serial.println("#ERR no sensor found (Qwiic SDA43/SCL44 or header SDA18/SCL17)");
}

void handleTriadCommand(const String &cmd) {
  char c = cmd.length() > 1 ? toupper(cmd[1]) : 0;
  if (!spOk) {
    Serial.println("#ERR AS7265x not connected");
    return;
  }
  if (c == 'A') {
    spAuto = true;
    Serial.println("#OK triad auto gain");
  } else if (c == 'G') {
    long v = cmd.substring(2).toInt();
    int idx = v == 1 ? 0 : (v == 3 || v == 4 || v == 37) ? 1 : v == 16 ? 2 : v == 64 ? 3 : -1;
    if (idx < 0) {
      Serial.println("#ERR triad gain must be 1, 4 (3.7), 16 or 64");
      return;
    }
    spAuto = false;
    spGainIdx = idx;
    spApplySettings();
    Serial.printf("#OK triad gain %g\n", SP_GAIN_VALUES[spGainIdx]);
  } else if (c == 'N') {
    long v = cmd.substring(2).toInt();
    if (v < 1 || v > 255) {
      Serial.println("#ERR integration cycles must be 1 ... 255");
      return;
    }
    spCycles = (uint8_t)v;
    spApplySettings();
    Serial.printf("#OK triad integration %.0f ms\n", spIntMs());
  } else if (c == 'L' && cmd.length() >= 4) {
    char which = toupper(cmd[2]);
    int idx = which == 'W' ? 0 : which == 'I' ? 1 : which == 'U' ? 2 : -1;
    if (idx < 0) {
      Serial.println("#ERR LED must be W, I or U");
      return;
    }
    spLed[idx] = cmd[3] == '1';
    spApplyLeds();
    Serial.printf("#OK triad LED %c %d\n", which, spLed[idx] ? 1 : 0);
  } else {
    Serial.println("#ERR triad commands: SA, SG<n>, SN<n>, SL<W|I|U><0|1>");
  }
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  char c = toupper(cmd[0]);
  if (c == 'S') {
    handleTriadCommand(cmd);
    return;
  }
  long v = cmd.substring(1).toInt();
  switch (c) {
    case 'A':
      uvAuto = true;
      Serial.println("#OK auto gain");
      break;
    case 'G': {
      int idx = -1;
      for (int i = 0; i < UV_N_GAINS; i++)
        if (UV_GAIN_VALUES[i] == v) idx = i;
      if (idx < 0) {
        Serial.println("#ERR gain must be 1, 2, 4 ... 2048");
        break;
      }
      uvAuto = false;
      uvGainIdx = idx;
      if (uvOk) uvApplySettings();
      Serial.printf("#OK gain %u\n", UV_GAIN_VALUES[uvGainIdx]);
      break;
    }
    case 'T': {
      int idx = -1;
      for (int i = 0; i < UV_N_TIMES; i++)
        if (UV_TIME_VALUES[i] == v) idx = i;
      if (idx < 0) {
        Serial.println("#ERR conversion time must be 1, 2, 4 ... 64 ms");
        break;
      }
      uvTimeIdx = idx;
      if (uvOk) uvApplySettings();
      Serial.printf("#OK conv %u ms\n", UV_TIME_VALUES[uvTimeIdx]);
      break;
    }
    case 'P':
      if (v < 100 || v > 60000) {
        Serial.println("#ERR period must be 100 ... 60000 ms");
        break;
      }
      periodMs = v;
      Serial.printf("#OK period %ld ms\n", v);
      break;
    case 'H':
      hold = !hold;
      Serial.printf("#OK hold %d\n", hold ? 1 : 0);
      break;
    case 'I':
      printInfo();
      break;
    default:
      Serial.println("#ERR unknown command (A, G<n>, T<ms>, P<ms>, H, I, SA, SG<n>, SN<n>, SL<W|I|U><0|1>)");
  }
}

void readSerial() {
  static String line;
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      handleCommand(line);
      line = "";
    } else if (line.length() < 40) {
      line += ch;
    }
  }
}

// =============================================================================================
void initSensors() {
  if (!uvOk) uvOk = uvInit();
  if (!spOk) spOk = spInit();
}

void setup() {
  pinMode(PIN_POWER_ON, OUTPUT);
  digitalWrite(PIN_POWER_ON, HIGH);
  pinMode(PIN_BUTTON_HOLD, INPUT_PULLUP);
  pinMode(PIN_BUTTON_SCREEN, INPUT_PULLUP);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxBufferSize(2048);
#endif
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(20); // never let a host that does not read stall the loop (and the display)
#endif

#if USE_DISPLAY
  lcd.init();
  lcd.setRotation(1); // landscape, USB on the right
  lcd.setBrightness(160);
  canvas.setColorDepth(16);
  canvas.setPsram(true);
  canvasOk = canvas.createSprite(320, 170) != nullptr;
#endif

  for (auto &b : BUSES) b.wire->begin(b.sda, b.scl, 100000);
  delay(50); // sensor power-up
  initSensors();
  printInfo();
#if USE_DISPLAY
  if (!uvOk && spOk) screen = 1;
  drawScreen();
#endif
}

// Debounced push button (active low): true once per press, after 40 ms of a stable level.
// Presses during the first second after start-up are ignored (pins settle, BOOT released).
struct Button {
  int pin;
  bool stable = true, last = true;
  uint32_t changedAt = 0;
  bool pressed() {
    bool v = digitalRead(pin);
    uint32_t now = millis();
    if (v != last) {
      last = v;
      changedAt = now;
    }
    if (now - changedAt < 40 || v == stable) return false;
    stable = v;
    return !v && now > 1000;
  }
};
Button btnHold{PIN_BUTTON_HOLD}, btnScreen{PIN_BUTTON_SCREEN};

void loop() {
  static uint32_t lastMeas = 0;
  static uint32_t lastRetry = 0;
  static uint32_t lastDraw = 0;

  readSerial();

  if (btnHold.pressed()) {
    hold = !hold;
#if USE_DISPLAY
    drawScreen();
#endif
  }
  if (btnScreen.pressed()) {
#if USE_DISPLAY
    screen = screen ? 0 : 1;
    drawScreen();
#endif
  }

#if USE_DISPLAY
  // Refresh the display on its own clock, independent of the measurement and the USB link
  if (!hold && millis() - lastDraw > 300) {
    lastDraw = millis();
    drawScreen();
  }
#endif

  // Look for missing sensors every 3 s (hot-plug, or after a failed measurement)
  if ((!uvOk || !spOk) && millis() - lastRetry > 3000) {
    lastRetry = millis();
    bool uvBefore = uvOk, spBefore = spOk;
    initSensors();
    if (uvOk != uvBefore || spOk != spBefore) {
      printInfo(); // a sensor appeared: tell the host
#if USE_DISPLAY
      if (!uvOk && spOk) screen = 1;
      drawScreen();
#endif
    }
  }

  if (!(uvOk || spOk) || millis() - lastMeas < periodMs) {
    delay(2);
    return;
  }
  lastMeas = millis();
  if (uvOk) uvStep(lastMeas);
  if (spOk) spStep(lastMeas);
}
