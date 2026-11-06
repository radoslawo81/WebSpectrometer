// State for the Transmission window (web-only): dark and 100 % snapshots (memory only — they are
// only valid for the current lamp/exposure), saved transmittance curves (localStorage).
import { useSyncExternalStore } from 'react'
import { computeTransmission, weightCurve, type Snapshot, type TransCurve } from '../core/transmission'
import { responseAt } from '../core/responseCal'
import { getLightResponse } from './lightStore'
import { pipeline } from './engine'

const SAVED_KEY = 'webspectrometer.transmissionCurves'
export const CURVE_COLORS = ['#d62728', '#1f77b4', '#2ca02c', '#9467bd', '#ff7f0e', '#8c564b']
const MAX_SAVED = 6

export interface SavedCurve {
  id: number
  label: string
  color: string
  visible: boolean
  curve: TransCurve
  weight?: TransCurve // lamp spectrum (response-corrected if available) used for energy shares
  time: number
}

interface TransState {
  dark: Snapshot | null
  blank: Snapshot | null
  saved: SavedCurve[]
}

function loadSaved(): SavedCurve[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as SavedCurve[]
    // JSON stores NaN as null
    const fix = (c?: TransCurve) => (c ? { ...c, t: c.t.map((v) => (v == null ? NaN : v)) } : undefined)
    return arr.map((c) => ({ ...c, curve: fix(c.curve)!, weight: fix(c.weight) }))
  } catch {
    return []
  }
}

function persist(saved: SavedCurve[]) {
  try {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify(
        saved.map((c) => ({
          ...c,
          curve: { ...c.curve, t: c.curve.t.map((v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null)) },
          weight: c.weight ? { ...c.weight, t: c.weight.t.map((v) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : null)) } : undefined,
        })),
      ),
    )
  } catch {
    // ignore
  }
}

let state: TransState = { dark: null, blank: null, saved: loadSaved() }
const listeners = new Set<() => void>()
function set(patch: Partial<TransState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useTrans(): TransState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

function snap(): Snapshot {
  return { nmMin: pipeline.nmMin, nmMax: pipeline.nmMax, values: Array.from(pipeline.spatialFiltered) }
}

export function saveDark(): void {
  set({ dark: snap() })
}
export function clearDark(): void {
  set({ dark: null })
}
export function saveBlank(): void {
  set({ blank: snap() })
}

// Live transmittance of the spectrum shown now against the 100 % snapshot
export function liveCurve(): TransCurve | string | null {
  if (!state.blank) return null
  return computeTransmission(snap(), state.blank, state.dark)
}

// Lamp spectrum used to weight energy shares: 100 % − dark, × response correction if calibrated
export function liveWeight(): TransCurve | null {
  if (!state.blank) return null
  const resp = getLightResponse()
  return weightCurve(state.blank, state.dark, resp ? (nm) => responseAt(resp, nm) : undefined)
}

export function saveSample(label: string): string | null {
  const c = liveCurve()
  if (c == null) return 'no-blank'
  if (typeof c === 'string') return c
  const used = new Set(state.saved.map((s) => s.color))
  const color = CURVE_COLORS.find((x) => !used.has(x)) ?? CURVE_COLORS[state.saved.length % CURVE_COLORS.length]
  const item: SavedCurve = {
    id: Date.now(),
    label: label || `Sample ${state.saved.length + 1}`,
    color,
    visible: true,
    curve: c,
    weight: liveWeight() ?? undefined,
    time: Date.now(),
  }
  const saved = [...state.saved, item].slice(-MAX_SAVED)
  persist(saved)
  set({ saved })
  return null
}

export function updateSaved(id: number, patch: Partial<Pick<SavedCurve, 'label' | 'visible'>>): void {
  const saved = state.saved.map((s) => (s.id === id ? { ...s, ...patch } : s))
  persist(saved)
  set({ saved })
}

export function removeSaved(id: number): void {
  const saved = state.saved.filter((s) => s.id !== id)
  persist(saved)
  set({ saved })
}
