// AS7331 UV sensor (UVA / UVB / UVC) over Web Serial (web-only).
// Firmware: firmware/as7331-tdisplay-s3 (ESP32-S3); any device that prints the same text lines works.
//
// Device → host lines:
//   #WSUV 1 AS7331 addr=0x74 sda=43 scl=44 gain=16 conv=64 period=250 auto=1   info
//   UV,<ms>,<uva>,<uvb>,<uvc>,<tempC>,<gain>,<convMs>,<flag>                   reading, µW/cm²
//   #OK <text> / #ERR <text>
// Host → device: A (auto gain), G<n>, T<ms>, P<ms>, H, I — one per line.

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

export type UvLine =
  | { kind: 'reading'; reading: UvReading }
  | { kind: 'info'; info: UvInfo }
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
