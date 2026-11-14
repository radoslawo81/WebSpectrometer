/*
  WebSpectrometer2.0 – AS7331 UV sensor (UVA / UVB / UVC) on a LILYGO T-Display-S3

  Reads the ams OSRAM AS7331 over I2C, shows the three channels on the built-in display and streams
  them over USB to WebSpectrometer2.0 (Tools → UV sensor…) as text lines.

  Hardware
    - LILYGO T-Display-S3 (ESP32-S3R8, ST7789 170×320 parallel display)
    - AS7331 breakout on the Qwiic / STEMMA QT connector next to USB-C (SDA = GPIO43, SCL = GPIO44)
      or on the side header (SDA = GPIO18, SCL = GPIO17). Both are tried automatically.
    - I2C address 0x74…0x77 is found automatically.

  Arduino IDE
    - Board package: "esp32" by Espressif (3.x)
    - Board: "LilyGo T-Display-S3" (or "ESP32S3 Dev Module" with Flash 16 MB, PSRAM "OPI PSRAM")
    - Tools → USB CDC On Boot → "Enabled"   (otherwise nothing arrives over USB-C)
    - Libraries (Library Manager): "SparkFun AS7331" (installs "SparkFun Toolkit"), "LovyanGFX"
      Without a display set USE_DISPLAY to 0 – LovyanGFX is then not needed.
    - Upload problems: hold BOOT, press RST, release BOOT, upload again.

  Serial protocol (115200 8N1 – the baud rate is ignored by USB CDC)
    Device → host
      #WSUV 1 AS7331 addr=0x74 sda=43 scl=44        info line (at start and on command I)
      UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flags>
          uva/uvb/uvc in µW/cm² (factory calibration of the AS7331), tempC in °C,
          flags: '-' ok, 'S' a channel near full scale (saturated), 'L' signal very low
      #ERR <text>                                     error
      #OK <text>                                      command accepted
    Host → device (one command per line)
      A          automatic gain (default)
      G<n>       fixed gain n = 1, 2, 4 … 2048 (switches automatic gain off)
      T<ms>      conversion time 1, 2, 4 … 64 ms (default 64; longer needs the digital divider)
      P<ms>      period between measurements, 50…60000 ms (default 250)
      H          hold / resume the display (same as the IO14 button)
      I          print the info line

  License: GNU GPL v3 (part of WebSpectrometer2.0, https://github.com/radoslawo81/WebSpectrometer2.0)
*/

#include <Arduino.h>
#include <Wire.h>
#include <SparkFun_AS7331.h>

#define USE_DISPLAY 1

// ---------------------------------------------------------------------------------------------
// Board pins (T-Display-S3)
static const int PIN_POWER_ON = 15; // must be HIGH for the display when running from battery
static const int PIN_BUTTON_HOLD = 14;
static const int I2C_PINS[][2] = {{43, 44}, {18, 17}}; // {SDA, SCL}: Qwiic connector, then side header

// Full-scale irradiance at gain 1× (µW/cm²) for UVA, UVB, UVC. For conversion times ≤ 64 ms the full
// scale depends on the gain only (a shorter time lowers the resolution, not the range).
static const float FS_GAIN1[3] = {349000.0f, 386000.0f, 169000.0f};

static const as7331_gain_t GAINS[] = {GAIN_1, GAIN_2, GAIN_4, GAIN_8, GAIN_16, GAIN_32,
                                      GAIN_64, GAIN_128, GAIN_256, GAIN_512, GAIN_1024, GAIN_2048};
static const uint16_t GAIN_VALUES[] = {1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048};
static const int N_GAINS = 12;
static const as7331_conv_time_t TIMES[] = {TIME_1MS, TIME_2MS, TIME_4MS, TIME_8MS, TIME_16MS, TIME_32MS, TIME_64MS};
static const uint16_t TIME_VALUES[] = {1, 2, 4, 8, 16, 32, 64};
static const int N_TIMES = 7;

SfeAS7331ArdI2C uv;
uint8_t sensorAddr = 0;
int sdaPin = -1, sclPin = -1;
bool sensorOk = false;

int gainIdx = 4;  // 16×
int timeIdx = 6;  // 64 ms
bool autoGain = true;
uint32_t periodMs = 250;
bool hold = false;

float lastUv[3] = {0, 0, 0};
float lastTemp = NAN;
char lastFlag = '-';

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

static const uint16_t COL_BG = 0x0841;
static const uint16_t COL_TXT = 0xEF7D;
static const uint16_t COL_MUTED = 0x8C71;
static const uint16_t COL_CH[3] = {0xA81F /* UVA violet */, 0x681F /* UVB */, 0x380F /* UVC */};
#endif

// ---------------------------------------------------------------------------------------------
float fullScale(int ch) { return FS_GAIN1[ch] / GAIN_VALUES[gainIdx]; }

void printInfo() {
  Serial.printf("#WSUV 1 AS7331 addr=0x%02X sda=%d scl=%d gain=%u conv=%u period=%lu auto=%d\n", sensorAddr, sdaPin, sclPin,
                GAIN_VALUES[gainIdx], TIME_VALUES[timeIdx], (unsigned long)periodMs, autoGain ? 1 : 0);
}

bool applySettings() {
  bool ok = uv.setGain(GAINS[gainIdx]) == ksfTkErrOk;
  ok = (uv.setConversionTime(TIMES[timeIdx]) == ksfTkErrOk) && ok;
  return ok;
}

// Find the sensor on either I2C pin pair and any of its four addresses
bool findSensor() {
  for (auto &p : I2C_PINS) {
    Wire.begin(p[0], p[1], 400000);
    for (uint8_t a = 0x74; a <= 0x77; a++) {
      Wire.beginTransmission(a);
      if (Wire.endTransmission() == 0 && uv.begin(a, Wire)) {
        sensorAddr = a;
        sdaPin = p[0];
        sclPin = p[1];
        return true;
      }
    }
    Wire.end();
  }
  return false;
}

bool initSensor() {
  if (!findSensor()) return false;
  if (!uv.prepareMeasurement(MEAS_MODE_CMD)) return false;
  return applySettings();
}

// One measurement in command (one-shot) mode
bool measure() {
  if (uv.setStartState(true) != ksfTkErrOk) return false;
  delay(2 + uv.getConversionTimeMillis());
  if (uv.readAllUV() != ksfTkErrOk) return false;
  lastUv[0] = uv.getUVA();
  lastUv[1] = uv.getUVB();
  lastUv[2] = uv.getUVC();
  if (uv.readTemp() == ksfTkErrOk) lastTemp = uv.getTemp();
  return true;
}

// Highest channel reading as a fraction of its full scale at the current gain
float rangeUse() {
  float r = 0;
  for (int c = 0; c < 3; c++) r = max(r, lastUv[c] / fullScale(c));
  return r;
}

// Automatic gain: keep the strongest channel between ~2 % and ~85 % of full scale
void autoRange(float r) {
  if (!autoGain) return;
  int target = gainIdx;
  if (r > 0.85f && gainIdx > 0) {
    target = gainIdx - (r > 0.98f ? 3 : 1); // clipped: step down faster
  } else if (r < 0.02f && gainIdx < N_GAINS - 1) {
    // jump close to ~40 % of full scale
    float wanted = GAIN_VALUES[gainIdx] * 0.4f / max(r, 1e-6f);
    while (target < N_GAINS - 1 && GAIN_VALUES[target + 1] <= wanted) target++;
  }
  target = constrain(target, 0, N_GAINS - 1);
  if (target != gainIdx) {
    gainIdx = target;
    applySettings();
  }
}

// ---------------------------------------------------------------------------------------------
void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  char c = toupper(cmd[0]);
  long v = cmd.substring(1).toInt();
  switch (c) {
    case 'A':
      autoGain = true;
      Serial.println("#OK auto gain");
      break;
    case 'G': {
      int idx = -1;
      for (int i = 0; i < N_GAINS; i++)
        if (GAIN_VALUES[i] == v) idx = i;
      if (idx < 0) {
        Serial.println("#ERR gain must be 1, 2, 4 ... 2048");
        break;
      }
      autoGain = false;
      gainIdx = idx;
      applySettings();
      Serial.printf("#OK gain %u\n", GAIN_VALUES[gainIdx]);
      break;
    }
    case 'T': {
      int idx = -1;
      for (int i = 0; i < N_TIMES; i++)
        if (TIME_VALUES[i] == v) idx = i;
      if (idx < 0) {
        Serial.println("#ERR conversion time must be 1, 2, 4 ... 64 ms");
        break;
      }
      timeIdx = idx;
      applySettings();
      Serial.printf("#OK conv %u ms\n", TIME_VALUES[timeIdx]);
      break;
    }
    case 'P':
      if (v < 50 || v > 60000) {
        Serial.println("#ERR period must be 50 ... 60000 ms");
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
      Serial.println("#ERR unknown command (A, G<n>, T<ms>, P<ms>, H, I)");
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

// ---------------------------------------------------------------------------------------------
#if USE_DISPLAY
// "123.4 µW/cm²" style with automatic unit
void formatIrr(float uw, char *val, char *unit) {
  if (uw >= 1000.0f) {
    snprintf(val, 16, uw >= 100000.0f ? "%.0f" : uw >= 10000.0f ? "%.1f" : "%.2f", uw / 1000.0f);
    strcpy(unit, "mW/cm2");
  } else {
    snprintf(val, 16, uw >= 100.0f ? "%.1f" : uw >= 1.0f ? "%.2f" : "%.3f", uw);
    strcpy(unit, "uW/cm2");
  }
}

void drawScreen() {
  if (!canvasOk) return;
  canvas.fillScreen(COL_BG);
  canvas.setTextDatum(textdatum_t::top_left);
  canvas.setFont(&fonts::Font2);
  canvas.setTextColor(COL_TXT, COL_BG);
  canvas.drawString("AS7331  UV", 8, 4);
  canvas.setTextColor(COL_MUTED, COL_BG);
  canvas.setTextDatum(textdatum_t::top_right);
  canvas.drawString(hold ? "HOLD" : (Serial ? "USB" : ""), 312, 4);

  if (!sensorOk) {
    canvas.setTextDatum(textdatum_t::middle_center);
    canvas.setTextColor(0xF800, COL_BG);
    canvas.drawString("AS7331 not found", 160, 70);
    canvas.setTextColor(COL_MUTED, COL_BG);
    canvas.drawString("Qwiic: SDA 43 / SCL 44", 160, 95);
    canvas.drawString("header: SDA 18 / SCL 17", 160, 115);
    canvas.pushSprite(0, 0);
    return;
  }

  const char *names[3] = {"UVA", "UVB", "UVC"};
  for (int c = 0; c < 3; c++) {
    int y = 26 + c * 42;
    canvas.fillRoundRect(8, y + 2, 46, 30, 6, COL_CH[c]);
    canvas.setTextDatum(textdatum_t::middle_center);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(TFT_WHITE, COL_CH[c]);
    canvas.drawString(names[c], 31, y + 17);

    char val[16], unit[8];
    formatIrr(lastUv[c], val, unit);
    canvas.setTextDatum(textdatum_t::middle_right);
    canvas.setFont(&fonts::Font4);
    canvas.setTextColor(COL_TXT, COL_BG);
    canvas.drawString(val, 196, y + 17);
    canvas.setTextDatum(textdatum_t::middle_left);
    canvas.setFont(&fonts::Font2);
    canvas.setTextColor(COL_MUTED, COL_BG);
    canvas.drawString(unit, 202, y + 17);

    // log bar: 0.01 µW/cm² … full scale
    float fs = fullScale(c);
    float frac = lastUv[c] > 0.01f ? log10f(lastUv[c] / 0.01f) / log10f(fs / 0.01f) : 0;
    frac = constrain(frac, 0.0f, 1.0f);
    canvas.drawRect(262, y + 8, 50, 18, COL_MUTED);
    canvas.fillRect(263, y + 9, (int)(48 * frac), 16, lastUv[c] / fs > 0.9f ? 0xF800 : COL_CH[c]);
  }

  canvas.setFont(&fonts::Font2);
  canvas.setTextDatum(textdatum_t::bottom_left);
  canvas.setTextColor(COL_MUTED, COL_BG);
  char foot[64];
  snprintf(foot, sizeof foot, "gain %u%s  %u ms  %.1f C", GAIN_VALUES[gainIdx], autoGain ? " auto" : "", TIME_VALUES[timeIdx],
           isnan(lastTemp) ? 0.0f : lastTemp);
  canvas.drawString(foot, 8, 166);
  if (lastFlag == 'S') {
    canvas.setTextDatum(textdatum_t::bottom_right);
    canvas.setTextColor(0xF800, COL_BG);
    canvas.drawString("SATURATED", 312, 166);
  }
  canvas.pushSprite(0, 0);
}
#endif

// ---------------------------------------------------------------------------------------------
void setup() {
  pinMode(PIN_POWER_ON, OUTPUT);
  digitalWrite(PIN_POWER_ON, HIGH);
  pinMode(PIN_BUTTON_HOLD, INPUT_PULLUP);
  Serial.begin(115200);

#if USE_DISPLAY
  lcd.init();
  lcd.setRotation(1); // landscape, USB on the right
  lcd.setBrightness(160);
  canvas.setColorDepth(16);
  canvas.setPsram(true);
  canvasOk = canvas.createSprite(320, 170) != nullptr;
#endif

  sensorOk = initSensor();
  if (sensorOk) printInfo();
  else Serial.println("#ERR AS7331 not found (Qwiic SDA43/SCL44 or header SDA18/SCL17, address 0x74-0x77)");
#if USE_DISPLAY
  drawScreen();
#endif
}

void loop() {
  static uint32_t lastMeas = 0;
  static uint32_t lastRetry = 0;
  static bool lastBtn = true;

  readSerial();

  bool btn = digitalRead(PIN_BUTTON_HOLD);
  if (!btn && lastBtn) {
    hold = !hold;
#if USE_DISPLAY
    drawScreen();
#endif
  }
  lastBtn = btn;

  if (!sensorOk) {
    if (millis() - lastRetry > 3000) {
      lastRetry = millis();
      sensorOk = initSensor();
      if (sensorOk) printInfo();
#if USE_DISPLAY
      drawScreen();
#endif
    }
    delay(10);
    return;
  }

  if (millis() - lastMeas < periodMs) {
    delay(2);
    return;
  }
  lastMeas = millis();

  if (!measure()) {
    Serial.println("#ERR measurement failed");
    sensorOk = false;
    return;
  }
  // Report the measurement with the gain it was taken at, then adjust the gain for the next one
  float r = rangeUse();
  lastFlag = r > 0.9f ? 'S' : (r < 0.0005f && gainIdx == N_GAINS - 1 ? 'L' : '-');
  Serial.printf("UV,%lu,%.4f,%.4f,%.4f,%.2f,%u,%u,%c\n", (unsigned long)lastMeas, lastUv[0], lastUv[1], lastUv[2],
                isnan(lastTemp) ? 0.0f : lastTemp, GAIN_VALUES[gainIdx], TIME_VALUES[timeIdx], lastFlag);
#if USE_DISPLAY
  if (!hold) drawScreen();
#endif
  autoRange(r);
}
