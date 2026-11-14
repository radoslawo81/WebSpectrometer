// Sensor board state (web-only): one serial connection shared by the AS7331 UV sensor and the
// AS7265x spectral triad windows. The connection and the reading logs live outside the windows,
// so closing a window keeps the board connected and logging.
import { useSyncExternalStore } from 'react'
import { getState } from './store'
import { applyTriadCorr, parseTriadCorr } from '../core/triadCorr'
import { UvSerial, type TriadInfo, type TriadReading, type UvInfo, type UvLine, type UvReading } from '../serial/uvSensor'

export interface UvState {
  connected: boolean
  connecting: boolean
  info: UvInfo | null
  last: UvReading | null
  rows: UvReading[]
  message: string | null // last #OK / #ERR text or connection error
  messageIsError: boolean
  resetAt: number // statistics since this time (ms)
  triadInfo: TriadInfo | null
  triadLast: TriadReading | null
  triadRows: TriadReading[]
  triadResetAt: number
}

const MAX_ROWS = 50000
const MAX_TRIAD_ROWS = 20000
const serial = new UvSerial()

let state: UvState = {
  connected: false,
  connecting: false,
  info: null,
  last: null,
  rows: [],
  message: null,
  messageIsError: false,
  resetAt: Date.now(),
  triadInfo: null,
  triadLast: null,
  triadRows: [],
  triadResetAt: Date.now(),
}
const listeners = new Set<() => void>()
function set(patch: Partial<UvState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useUv(): UvState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
export const getUvState = (): UvState => state
export function subscribeUv(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function onLine(l: UvLine) {
  if (!l) return
  if (l.kind === 'reading') {
    const rows = state.rows.length >= MAX_ROWS ? state.rows.slice(-MAX_ROWS + 1) : state.rows.slice()
    rows.push(l.reading)
    set({ last: l.reading, rows })
  } else if (l.kind === 'triad') {
    const rows = state.triadRows.length >= MAX_TRIAD_ROWS ? state.triadRows.slice(-MAX_TRIAD_ROWS + 1) : state.triadRows.slice()
    const c = parseTriadCorr(getState().settings.TriadCorr)
    const r = { ...l.reading, factory: l.reading.values, values: applyTriadCorr(l.reading.values, c), corrected: !!c }
    rows.push(r)
    set({ triadLast: r, triadRows: rows })
  } else if (l.kind === 'triadInfo') set({ triadInfo: l.info })
  else if (l.kind === 'info') set({ info: l.info })
  else if (l.kind === 'ok') set({ message: l.text, messageIsError: false })
  else set({ message: l.text, messageIsError: true })
}

export async function uvConnect(): Promise<void> {
  if (state.connected || state.connecting) return
  set({ connecting: true, message: null, messageIsError: false })
  try {
    await serial.connect(onLine, (err) =>
      set({
        connected: false,
        connecting: false,
        message: err ? String((err as Error).message ?? err) : null,
        messageIsError: !!err,
      }),
    )
    set({ connected: true, connecting: false })
  } catch (e) {
    // Cancelling the port chooser is not an error worth showing
    const name = (e as Error)?.name
    set({
      connecting: false,
      message: name === 'NotFoundError' ? null : String((e as Error)?.message ?? e),
      messageIsError: name !== 'NotFoundError',
    })
  }
}

export async function uvDisconnect(): Promise<void> {
  await serial.disconnect()
  set({ connected: false })
}

export function uvSend(cmd: string): void {
  void serial.send(cmd).then(() => serial.send('I'))
}

export function uvClear(): void {
  set({ rows: [], resetAt: Date.now() })
}

export function triadClear(): void {
  set({ triadRows: [], triadResetAt: Date.now() })
}

export function recentTriad(maxAgeMs = 10000): TriadReading | null {
  const r = state.triadLast
  return state.connected && r && Date.now() - r.t <= maxAgeMs ? r : null
}

// Mean of the last n triad readings (fewer if not available); null without readings
export function triadAverage(rows: TriadReading[], n: number): TriadReading | null {
  const sel = rows.slice(-n)
  if (!sel.length) return null
  const last = sel[sel.length - 1]
  const values = last.values.map((_, i) => sel.reduce((a, r) => a + r.values[i], 0) / sel.length)
  const factory = last.values.map((_, i) => sel.reduce((a, r) => a + (r.factory ?? r.values)[i], 0) / sel.length)
  return { ...last, values, factory, flag: sel.some((r) => r.flag === 'S') ? 'S' : last.flag }
}

export function triadRowsToCsv(rows: TriadReading[]): string {
  const nm = rows[0]?.nm ?? []
  const head = ['Time', 'Elapsed_s', ...nm.map((x) => `${x}nm_uW_cm2`), 'Temp_C', 'Gain', 'Int_ms', 'Flag'].join(';')
  const t0 = rows.length ? rows[0].t : 0
  const lines = rows.map((r) =>
    [
      new Date(r.t).toISOString(),
      ((r.t - t0) / 1000).toFixed(2),
      ...r.values.map((v) => v.toPrecision(6)),
      r.tempC == null ? '' : r.tempC.toFixed(1),
      String(r.gain),
      String(r.intMs),
      r.flag,
    ].join(';'),
  )
  return [head, ...lines].join('\n') + '\n'
}

// The last reading, if it is at most maxAgeMs old (for files and reports)
export function recentUv(maxAgeMs = 10000): UvReading | null {
  const r = state.last
  return state.connected && r && Date.now() - r.t <= maxAgeMs ? r : null
}

export interface UvStats {
  n: number
  min: [number, number, number]
  max: [number, number, number]
  mean: [number, number, number]
}

export function uvStats(rows: UvReading[]): UvStats | null {
  if (!rows.length) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const sum: [number, number, number] = [0, 0, 0]
  for (const r of rows) {
    const v = [r.uva, r.uvb, r.uvc]
    for (let c = 0; c < 3; c++) {
      if (v[c] < min[c]) min[c] = v[c]
      if (v[c] > max[c]) max[c] = v[c]
      sum[c] += v[c]
    }
  }
  return { n: rows.length, min, max, mean: [sum[0] / rows.length, sum[1] / rows.length, sum[2] / rows.length] }
}

export function uvRowsToCsv(rows: UvReading[]): string {
  const head = 'Time;Elapsed_s;UVA_uW_cm2;UVB_uW_cm2;UVC_uW_cm2;Temp_C;Gain;Conv_ms;Flag'
  const t0 = rows.length ? rows[0].t : 0
  const lines = rows.map((r) =>
    [
      new Date(r.t).toISOString(),
      ((r.t - t0) / 1000).toFixed(2),
      r.uva.toPrecision(6),
      r.uvb.toPrecision(6),
      r.uvc.toPrecision(6),
      r.tempC == null ? '' : r.tempC.toFixed(2),
      String(r.gain),
      String(r.convMs),
      r.flag,
    ].join(';'),
  )
  return [head, ...lines].join('\n') + '\n'
}

// "12.3 µW/cm²" / "4.56 mW/cm²"
export function formatIrradiance(uw: number): { value: string; unit: string } {
  if (uw >= 1000) {
    const v = uw / 1000
    return { value: v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2), unit: 'mW/cm²' }
  }
  return { value: uw >= 100 ? uw.toFixed(1) : uw >= 1 ? uw.toFixed(2) : uw.toFixed(3), unit: 'µW/cm²' }
}
