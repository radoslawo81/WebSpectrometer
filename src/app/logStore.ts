// Time-series logging of spectrum quantities (web-only). Runs independently of the window.
import { useSyncExternalStore } from 'react'
import { pipeline } from './engine'
import { currentLight, getLux } from './lightStore'

export interface LogConfig {
  intervalS: number
  bandLo: number
  bandHi: number
  atNm: number
  atWidth: number // ± nm averaged around atNm
}

export interface LogRow {
  t: number // ms since epoch
  total: number // integrated intensity over the whole axis (value·nm)
  band: number // integrated over bandLo–bandHi
  at: number // mean value in atNm ± atWidth
  peakNm: number // wavelength of the maximum
  peakValue: number
  cct: number | null
  lux: number | null
}

interface LogState {
  running: boolean
  rows: LogRow[]
  cfg: LogConfig
  startedAt: number | null
}

const CFG_KEY = 'webspectrometer.logConfig'
const MAX_ROWS = 20000

function loadCfg(): LogConfig {
  try {
    const s = localStorage.getItem(CFG_KEY)
    if (s) return { ...DEFAULT_CFG, ...(JSON.parse(s) as Partial<LogConfig>) }
  } catch {
    // ignore
  }
  return DEFAULT_CFG
}
const DEFAULT_CFG: LogConfig = { intervalS: 5, bandLo: 400, bandHi: 700, atNm: 546, atWidth: 2 }

let state: LogState = { running: false, rows: [], cfg: loadCfg(), startedAt: null }
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()
function set(patch: Partial<LogState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useLog(): LogState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function setLogConfig(patch: Partial<LogConfig>): void {
  const cfg = { ...state.cfg, ...patch }
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
  } catch {
    // ignore
  }
  set({ cfg })
  if (state.running) restart()
}

export function sampleNow(): LogRow {
  const v = pipeline.spatialFiltered
  const n = v.length
  const { nmMin, nmMax } = pipeline
  const step = (nmMax - nmMin) / n
  const { bandLo, bandHi, atNm, atWidth } = state.cfg
  let total = 0
  let band = 0
  let atSum = 0
  let atCnt = 0
  let pi = 0
  for (let i = 0; i < n; i++) {
    const nm = nmMin + step * i
    const x = v[i]
    total += x * step
    if (nm >= bandLo && nm < bandHi) band += x * step
    if (Math.abs(nm - atNm) <= atWidth) {
      atSum += x
      atCnt++
    }
    if (x > v[pi]) pi = i
  }
  const light = currentLight()
  const m = light.metrics
  return {
    t: Date.now(),
    total,
    band,
    at: atCnt ? atSum / atCnt : NaN,
    peakNm: nmMin + step * pi,
    peakValue: v[pi] ?? 0,
    cct: m?.cct ?? null,
    lux: m && light.corrected ? getLux(m.photometricSum) : null,
  }
}

function tick() {
  const rows = state.rows.length >= MAX_ROWS ? state.rows.slice(-MAX_ROWS + 1) : state.rows.slice()
  rows.push(sampleNow())
  set({ rows })
}

function restart() {
  if (timer) clearInterval(timer)
  timer = setInterval(tick, Math.max(0.5, state.cfg.intervalS) * 1000)
}

export function startLog(): void {
  if (state.running) return
  set({ running: true, startedAt: state.startedAt ?? Date.now() })
  tick()
  restart()
}

export function stopLog(): void {
  if (timer) clearInterval(timer)
  timer = null
  set({ running: false })
}

export function clearLog(): void {
  set({ rows: [], startedAt: state.running ? Date.now() : null })
}

export function logToCsv(rows: LogRow[], cfg: LogConfig): string {
  const head = [
    'time_iso',
    'elapsed_s',
    'total_area',
    `band_${cfg.bandLo}-${cfg.bandHi}nm_area`,
    `value_at_${cfg.atNm}nm`,
    'peak_nm',
    'peak_value',
    'cct_K',
    'illuminance_lx',
  ].join(';')
  const t0 = rows[0]?.t ?? 0
  const f = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(d))
  return (
    [
      head,
      ...rows.map((r) =>
        [new Date(r.t).toISOString(), ((r.t - t0) / 1000).toFixed(1), f(r.total, 1), f(r.band, 1), f(r.at, 1), f(r.peakNm, 2), f(r.peakValue, 1), f(r.cct, 0), f(r.lux, 2)].join(';'),
      ),
    ].join('\n') + '\n'
  )
}

