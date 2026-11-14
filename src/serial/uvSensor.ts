// Sensor board over Web Serial (web-only): AS7331 UV sensor (UVA / UVB / UVC) and AS7265x spectral
// triad (18 channels, 410–940 nm). Firmware: firmware/tdisplay-s3-sensors (ESP32-S3); any device that
// prints the same text lines works.
//
// Device → host lines:
//   #WSUV 1 AS7331 addr=0x74 sda=43 scl=44 gain=16 conv=64 period=250 auto=1   info
//   UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flag>                   reading, µW/cm²
//   #WSSP 1 AS7265X sda=43 scl=44 gain=16 cycles=50 int=140 auto=1 led=000 nm=410,…,940   triad info
//   SP,<ms>,<v1>,…,<v18>,<tempC>,<gain>,<intMs>,<flag>                                  triad reading, µW/cm²
//   #OK <text> / #ERR <text>
// Host → device: A, G<n>, T<ms> (AS7331) · SA, SG<n>, SN<n>, SL<W|I|U><0|1> (AS7265x) · P<ms>, H, I

export type UvFlag = '-' | 'S' | 'L'

export interface UvReading {
  t: number // host time, ms since epoch
  deviceMs: number
  uva: number // µW/cm²
  uvb: number
  uvc: number
  tempC: number | null
  gain: number
  convMs: number
  flag: UvFlag // '-' ok, 'S' near full scale, 'L' very low signal
}

export interface UvInfo {
  model: string
  addr: string | null
  sda: number | null
  scl: number | null
  gain: number | null
  conv: number | null
  period: number | null
  auto: boolean | null
}

// AS7265x channel centres (nm), in the order of the SP line
export const TRIAD_NM = [410, 435, 460, 485, 510, 535, 560, 585, 610, 645, 680, 705, 730, 760, 810, 860, 900, 940]

export interface TriadReading {
  t: number
  deviceMs: number
  nm: number[]
  values: number[] // µW/cm² per channel (factory calibration)
  tempC: number | null
  gain: number
  intMs: number
  flag: UvFlag
}

export interface TriadInfo {
  sda: number | null
  scl: number | null
  gain: number | null
  cycles: number | null
  intMs: number | null
  auto: boolean | null
  led: [boolean, boolean, boolean] // white, IR, UV
  nm: number[]
}

export type UvLine =
  | { kind: 'reading'; reading: UvReading }
  | { kind: 'info'; info: UvInfo }
  | { kind: 'triad'; reading: TriadReading }
  | { kind: 'triadInfo'; info: TriadInfo }
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string }
  | null

const num = (s: string | undefined): number | null => {
  if (s == null || s === '') return null
  const v = Number.parseFloat(s)
  return Number.isFinite(v) ? v : null
}

export function parseUvLine(raw: string, now = Date.now()): UvLine {
  const line = raw.trim()
  if (!line) return null
  if (line.startsWith('UV,')) {
    const p = line.split(',')
    if (p.length < 5) return null
    const uva = num(p[2])
    const uvb = num(p[3])
    const uvc = num(p[4])
    if (uva == null || uvb == null || uvc == null) return null
    const f = (p[8] ?? '-').trim()
    return {
      kind: 'reading',
      reading: {
        t: now,
        deviceMs: num(p[1]) ?? 0,
        uva: Math.max(0, uva),
        uvb: Math.max(0, uvb),
        uvc: Math.max(0, uvc),
        tempC: num(p[5]),
        gain: num(p[6]) ?? 0,
        convMs: num(p[7]) ?? 0,
        flag: f === 'S' || f === 'L' ? f : '-',
      },
    }
  }
  if (line.startsWith('SP,')) {
    const p = line.split(',')
    // SP, ms, 18 values, temp, gain, int, flag
    if (p.length < 2 + TRIAD_NM.length) return null
    const values = p.slice(2, 2 + TRIAD_NM.length).map((x) => Number.parseFloat(x))
    if (values.some((v) => !Number.isFinite(v))) return null
    const rest = p.slice(2 + TRIAD_NM.length)
    const f = (rest[3] ?? '-').trim()
    return {
      kind: 'triad',
      reading: {
        t: now,
        deviceMs: num(p[1]) ?? 0,
        nm: TRIAD_NM.slice(),
        values: values.map((v) => Math.max(0, v)),
        tempC: num(rest[0]),
        gain: num(rest[1]) ?? 0,
        intMs: num(rest[2]) ?? 0,
        flag: f === 'S' || f === 'L' ? f : '-',
      },
    }
  }
  if (line.startsWith('#WSSP')) {
    const kv: Record<string, string> = {}
    for (const m of line.matchAll(/(\w+)=(\S+)/g)) kv[m[1]] = m[2]
    const led = (kv.led ?? '000').padEnd(3, '0')
    const nm = (kv.nm ?? '')
      .split(',')
      .map((x) => Number.parseFloat(x))
      .filter(Number.isFinite)
    return {
      kind: 'triadInfo',
      info: {
        sda: num(kv.sda),
        scl: num(kv.scl),
        gain: num(kv.gain),
        cycles: num(kv.cycles),
        intMs: num(kv.int),
        auto: kv.auto == null ? null : kv.auto === '1',
        led: [led[0] === '1', led[1] === '1', led[2] === '1'],
        nm: nm.length === TRIAD_NM.length ? nm : TRIAD_NM.slice(),
      },
    }
  }
  if (line.startsWith('#WSUV')) {
    const kv: Record<string, string> = {}
    for (const m of line.matchAll(/(\w+)=(\S+)/g)) kv[m[1]] = m[2]
    const parts = line.split(/\s+/)
    return {
      kind: 'info',
      info: {
        model: parts[2] && !parts[2].includes('=') ? parts[2] : 'AS7331',
        addr: kv.addr ?? null,
        sda: num(kv.sda),
        scl: num(kv.scl),
        gain: num(kv.gain),
        conv: num(kv.conv),
        period: num(kv.period),
        auto: kv.auto == null ? null : kv.auto === '1',
      },
    }
  }
  if (line.startsWith('#OK')) return { kind: 'ok', text: line.slice(3).trim() }
  if (line.startsWith('#ERR')) return { kind: 'error', text: line.slice(4).trim() }
  return null
}

// Splits a text stream into lines; keeps the unfinished tail between chunks
export class LineSplitter {
  private tail = ''
  push(chunk: string): string[] {
    const s = this.tail + chunk
    const parts = s.split(/\r?\n/)
    this.tail = parts.pop() ?? ''
    if (this.tail.length > 1000) this.tail = '' // garbage without newlines
    return parts
  }
}

export class UvSerial {
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<string> | null = null
  private closed: Promise<void> | null = null
  private running = false

  get isOpen(): boolean {
    return !!this.port
  }

  async connect(onLine: (l: UvLine) => void, onEnd: (err?: unknown) => void): Promise<void> {
    if (!('serial' in navigator)) throw new Error('Web Serial not supported')
    const port = await navigator.serial.requestPort()
    await port.open({ baudRate: 115200 })
    this.port = port
    this.running = true
    // DTR/RTS high: some USB-CDC stacks only send while the host signals it is ready
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true })
    } catch {
      // not supported – ignore
    }
    const decoder = new TextDecoderStream()
    this.closed = port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => undefined)
    this.reader = decoder.readable.getReader()
    const split = new LineSplitter()
    void this.send('I')
    ;(async () => {
      let err: unknown
      try {
        while (this.running) {
          const { value, done } = await this.reader!.read()
          if (done) break
          for (const l of split.push(value)) {
            const parsed = parseUvLine(l)
            if (parsed) onLine(parsed)
          }
        }
      } catch (e) {
        err = e
      }
      await this.cleanup()
      onEnd(err)
    })()
  }

  async send(cmd: string): Promise<void> {
    const port = this.port
    if (!port?.writable) return
    const w = port.writable.getWriter()
    try {
      await w.write(new TextEncoder().encode(cmd + '\n'))
    } finally {
      w.releaseLock()
    }
  }

  async disconnect(): Promise<void> {
    this.running = false
    try {
      await this.reader?.cancel()
    } catch {
      // ignore
    }
  }

  private async cleanup(): Promise<void> {
    try {
      this.reader?.releaseLock()
    } catch {
      // ignore
    }
    this.reader = null
    try {
      await this.closed
    } catch {
      // ignore
    }
    try {
      await this.port?.close()
    } catch {
      // ignore
    }
    this.port = null
    this.closed = null
  }
}
