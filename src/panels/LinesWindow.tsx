// Spectral lines window (web-only): reference-line overlay, peak identification, 2nd-order markers
import { useEffect, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { setSettings, useAppState } from '../app/store'
import { useT } from '../i18n'
import { pipeline } from '../app/engine'
import { LINE_SETS, type LineSet } from '../core/lines'
import { identifyPeaks, secondOrderStart, type IdentifiedPeak } from '../core/lineIdent'
import { useWindowPos } from './useWindowPos'

export function parseSets(s: string): LineSet[] {
  return s.split(',').filter(Boolean) as LineSet[]
}

export function LinesWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { settings } = useAppState()
  const [pos, onMove] = useWindowPos('lines', { x: 420, y: 120 })
  const sets = parseSets(settings.LinesSets)
  const [peaks, setPeaks] = useState<IdentifiedPeak[]>([])
  const [so, setSo] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => {
      setPeaks(identifyPeaks(pipeline.spatialFiltered, pipeline.nmMin, pipeline.nmMax, sets, settings.SecondOrder, 15))
      setSo(secondOrderStart(pipeline.spatialFiltered, pipeline.nmMin, pipeline.nmMax))
    }
    tick()
    const id = setInterval(tick, 700)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.LinesSets, settings.SecondOrder])

  const toggleSet = (k: LineSet) => {
    const next = sets.includes(k) ? sets.filter((x) => x !== k) : [...sets, k]
    setSettings({ LinesSets: next.join(',') })
  }

  return (
    <FloatingWindow title={t('Ln_Title')} x={pos.x} y={pos.y} width={400} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
          {LINE_SETS.map((s) => (
            <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={sets.includes(s.key)} onChange={() => toggleSet(s.key)} />
              <span style={{ width: 10, height: 10, background: SET_COLORS[s.key], display: 'inline-block' }} />
              {t(`Ln_Set_${s.key}`)}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgb(210,200,170)', paddingTop: 4 }}>
          <label>
            <input type="checkbox" checked={settings.LinesOverlay} onChange={(e) => setSettings({ LinesOverlay: e.target.checked })} /> {t('Ln_Overlay')}
          </label>
          <label>
            <input type="checkbox" checked={settings.LinesIdentify} onChange={(e) => setSettings({ LinesIdentify: e.target.checked })} /> {t('Ln_Identify')}
          </label>
          <label title={t('Ln_SecondTip')}>
            <input type="checkbox" checked={settings.SecondOrder} onChange={(e) => setSettings({ SecondOrder: e.target.checked })} /> {t('Ln_Second')}
          </label>
        </div>
        {settings.SecondOrder && so != null && (
          <div style={{ fontSize: 11, color: 'rgb(140,80,0)' }}>{t('Ln_SecondZone').replace('{nm}', so.toFixed(0))}</div>
        )}
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid rgb(210,200,170)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.6)' }}>
                <th style={{ textAlign: 'right' }}>{t('Ln_Measured')}</th>
                <th style={{ textAlign: 'left', paddingLeft: 8 }}>{t('Ln_Match')}</th>
                <th style={{ textAlign: 'right' }}>Δ nm</th>
              </tr>
            </thead>
            <tbody>
              {peaks.map((p) => (
                <tr key={p.nm.toFixed(2)}>
                  <td style={{ textAlign: 'right' }}>{p.nm.toFixed(2)}</td>
                  <td style={{ paddingLeft: 8, color: p.match ? SET_COLORS[p.match.line.set] : 'rgb(140,140,140)' }}>
                    {p.match
                      ? `${p.match.order === 2 ? '2× ' : ''}${p.match.line.label} ${p.match.line.nm.toFixed(2)}${p.match.line.approx ? ' ~' : ''}${p.match.line.kind === 'absorption' ? ` (${t('Ln_Abs')})` : ''}`
                      : t('Ln_Unknown')}
                  </td>
                  <td style={{ textAlign: 'right' }}>{p.match ? `${p.match.delta >= 0 ? '+' : ''}${p.match.delta.toFixed(2)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'rgb(120,120,120)' }}>{t('Ln_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}

export const SET_COLORS: Record<LineSet, string> = {
  Hg: '#1f77b4',
  Ar: '#9467bd',
  Ne: '#d62728',
  Na: '#ff7f0e',
  H: '#2ca02c',
  He: '#8c564b',
  CFL: '#e377c2',
  Sun: '#7f7f7f',
}
