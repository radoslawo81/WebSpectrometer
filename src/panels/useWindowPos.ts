// Remembered position of a floating window (web-only windows), kept in localStorage
import { useCallback, useState } from 'react'

export function useWindowPos(key: string, initial: { x: number; y: number }): [{ x: number; y: number }, (x: number, y: number) => void] {
  const storageKey = `webspectrometer.win.${key}`
  const [pos, setPos] = useState(() => {
    try {
      const s = localStorage.getItem(storageKey)
      if (s) {
        const p = JSON.parse(s) as { x: number; y: number }
        // Keep the window reachable if the browser window got smaller
        return { x: Math.min(Math.max(0, p.x), window.innerWidth - 120), y: Math.min(Math.max(0, p.y), window.innerHeight - 60) }
      }
    } catch {
      // ignore
    }
    return initial
  })
  const onMove = useCallback(
    (x: number, y: number) => {
      setPos({ x, y })
      try {
        localStorage.setItem(storageKey, JSON.stringify({ x, y }))
      } catch {
        // ignore
      }
    },
    [storageKey],
  )
  return [pos, onMove]
}
