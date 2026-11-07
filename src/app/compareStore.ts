// Reference / compared spectra for the Compare window (web-only).
// The reference survives page reloads (localStorage); results live in memory.
import { useSyncExternalStore } from 'react'
import { compareSpectra, snapshotSpectrum, type CompareResult, type SpectrumSnapshot } from '../core/compare'
import { pipeline } from './engine'

const STORAGE_KEY = 'webspectrometer.compareReference'

interface CompareState {
  reference: SpectrumSnapshot | null
  current: SpectrumSnapshot | null
  result: CompareResult | null
}

function loadReference(): SpectrumSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SpectrumSnapshot
    return Array.isArray(s.values) && s.values.length > 1 ? s : null
  } catch {
    return null
  }
}

let state: CompareState = { reference: loadReference(), current: null, result: null }
const listeners = new Set<() => void>()

function set(patch: Partial<CompareState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useCompare(): CompareState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function getCompareState(): CompareState {
  return state
}

export function getCompareReference(): SpectrumSnapshot | null {
  return state.reference
}

// Current spectrum as shown (after averaging, filters, reference/background corrections)
function takeSnapshot(): SpectrumSnapshot {
  return snapshotSpectrum(pipeline.spatialFiltered, pipeline.nmMin, pipeline.nmMax)
}

export function saveReference(): void {
  const ref = takeSnapshot()
  try {
    // Values rounded to 0.01 to keep the stored JSON small
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...ref, values: ref.values.map((v) => Math.round(v * 100) / 100) }))
  } catch {
    // storage full or blocked: keep the reference in memory only
  }
  set({ reference: ref, current: null, result: null })
}

export function saveAndCompare(): void {
  if (!state.reference) return
  const cur = takeSnapshot()
  set({ current: cur, result: compareSpectra(state.reference, cur) })
}

export function clearReference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  set({ reference: null, current: null, result: null })
}
