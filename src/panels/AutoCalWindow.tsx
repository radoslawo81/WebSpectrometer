// Automatic wavelength calibration window (web-only)
import { useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { getState, markCalibrated, setCalibration } from '../app/store'
import { pipeline } from '../app/engine'
import { useLight } from '../app/lightStore'
import { autoCalibrate, finalize, predictedNm, type AutoCalResult } from '../core/autocal'
import { CAL_SOURCES } from '../core/lines'
import { serializeCalibration } from '../core/calibration'
import { downloadText } from '../core/files'
import { useWindowPos } from './useWindowPos'

export function AutoCalWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('autocal', { x: 330, y: 100 })
  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem('webspectrometer.autocalSource') || 'cfl'
    } catch {
      return 'cfl'
    }
  })
  const [res, setRes] = useState<AutoCalResult | null>(null)
  const [applied, setApplied] = useState(false)
  const { response } = useLight()

  const run = () => {
    const st = getState()
    const src = CAL_SOURCES.find((s) => s.key === source) ?? CAL_SOURCES[0]
    try {
      localStorage.setItem('webspectrometer.autocalSource', source)
    } catch {
      // ignore
    }
    setApplied(false)
    setRes(autoCalibrate(pipeline.uncorrected, pipeline.nmMin, pipeline.nmMax, st.calibration, st.calibrationSamples, src, pipeline.saturation))
  }

  const toggleUse = (i: number) => {
    if (!res) return
    const matches = res.matches.map((m, k) => (k === i ? { ...m, use: !m.use } : m))
    setRes(finalize(matches, getState().calibrationSamples))
  }

  const apply = () => {
    if (!res?.calibration) return
    setCalibration(res.calibration, getState().calibrationSamples)
    markCalibrated()
    setApplied(true)
  }

  const save = () => {
    if (!res?.calibration) return
    downloadText('Calibration.txt', serializeCalibration(res.calibration, getState().calibrationSamples))
  }

  const msg =
    res?.message === 'flipped'
      ? t('Ac_Flipped')
      : res?.message === 'nopeaks'
        ? t('Ac_NoPeaks')
        : res && !res.ok
          ? t('Ac_Few')
          : ''

  return (
    <FloatingWindow title={t('Ac_Title')} x={pos.x} y={pos.y} width={470} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Ac_Intro')}</div>
        <div className="field-row" style={{ gap: 6 }}>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={{ flex: 1 }}>
            {CAL_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(`Ac_Src_${s.key}`)}
              </option>
            ))}
          </select>
          <ToggleButton onClick={run}>{t('Ac_Find')}</ToggleButton>
        </div>

        {msg && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{msg}</div>}

        {res && res.matches.length > 0 && (
          <>
            {res.ok && (
              <div style={{ fontSize: 11 }}>
                {t('Ac_Summary')
                  .replace('{n}', String(res.matches.filter((m) => m.use).length))
                  .replace('{m}', String(res.matches.length))
                  .replace('{rms}', res.rms.toFixed(2))
                  .replace('{disp}', res.dispersion.toFixed(3))
                  .replace('{lo}', res.rangeNm[0].toFixed(0))
                  .replace('{hi}', res.rangeNm[1].toFixed(0))}
              </div>
            )}
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th title={t('Ac_UseTip')}>{t('Ac_Use')}</th>
                    <th style={{ textAlign: 'left' }}>{t('Ac_Line')}</th>
                    <th style={{ textAlign: 'right' }}>nm</th>
                    <th style={{ textAlign: 'right' }} title={t('Ac_FitTip')}>
                      {t('Ac_Fit')}
                    </th>
                    <th style={{ textAlign: 'right' }} title={t('Ac_NewTip')}>
                      {t('Ac_New')}
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {res.matches.map((m, i) => {
                    const after = res.calibration ? predictedNm(res.calibration, m) - m.line.nm : NaN
                    const bad = Math.abs(m.residual) > 0.8
                    return (
                      <tr key={`${m.line.label}${m.line.nm}`} style={{ opacity: m.use ? 1 : 0.65 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={m.use} onChange={() => toggleUse(i)} />
                        </td>
                        <td>
                          {m.line.label}
                          {m.line.approx ? ' ~' : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>{m.line.nm.toFixed(2)}</td>
                        <td style={{ textAlign: 'right', color: bad ? 'rgb(190,0,0)' : undefined }}>{`${m.residual >= 0 ? '+' : ''}${m.residual.toFixed(2)}`}</td>
                        <td style={{ textAlign: 'right' }}>{Number.isFinite(after) ? `${after >= 0 ? '+' : ''}${after.toFixed(2)}` : '—'}</td>
                        <td style={{ color: 'rgb(190,0,0)' }} title={m.saturated ? t('Ac_SatTip') : undefined}>
                          {m.saturated ? '⚠' : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="field-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              <ToggleButton onClick={save}>{t('Ac_Save')}</ToggleButton>
              <ToggleButton onClick={apply} active={applied}>
                {applied ? t('Ac_Applied') : t('Ac_Apply')}
              </ToggleButton>
            </div>
            {applied && response && <div style={{ color: 'rgb(160,90,0)', fontSize: 11 }}>{t('Ac_RedoResponse')}</div>}
          </>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('Ac_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
