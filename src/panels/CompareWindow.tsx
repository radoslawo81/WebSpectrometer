// Compare spectra floating window (web-only feature)
// 1) Save reference  2) switch to the second source  3) Save & compare → % differences, total and per band
import { useCallback, useEffect, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { setSettings, useAppState } from '../app/store'
import { useT } from '../i18n'
import { clearReference, saveAndCompare, saveReference, useCompare } from '../app/compareStore'
import { isCalibrated, type BandResult } from '../core/compare'

const POS_KEY = 'webspectrometer.compareWindowPos'

const BAND_LABEL: Record<string, string> = {
  Total: 'Cmp_Total',
  UV: 'Cmp_UV',
  B: 'Cmp_B',
  G: 'Cmp_G',
  R: 'Cmp_R',
  IR: 'Cmp_IR',
}

function fmtPct(v: number | null, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) < 0.05) v = 0 // avoid “+0.0 %” / “−0.0 %” from rounding noise
  const s = v.toFixed(Math.abs(v) < 10 ? 1 : 0)
  return signed && v > 0 ? `+${s} %` : `${s} %`
}

function fmtRange(b: BandResult): string {
  return Number.isFinite(b.lo) ? `${Math.round(b.lo)}–${Math.round(b.hi)}` : '—'
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString()
}

export function CompareWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { settings } = useAppState()
  const { reference, current, result } = useCompare()
  const [pos, setPos] = useState({ x: 360, y: 140 })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY)
      if (saved) setPos(JSON.parse(saved))
    } catch {
      // ignore
    }
  }, [])
  const onMove = useCallback((x: number, y: number) => {
    setPos({ x, y })
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x, y }))
    } catch {
      // ignore
    }
  }, [])

  const rows = result ? [result.total, ...result.bands] : []
  const calibrationDiffers =
    reference && current && (Math.abs(reference.nmMin - current.nmMin) > 0.01 || Math.abs(reference.nmMax - current.nmMax) > 0.01)
  const uncalibrated = (reference && !isCalibrated(reference)) || (current && !isCalibrated(current))

  const copy = () => {
    if (!result) return
    const lines = [
      ['band', 'range_nm', 'diff_pct', 'ref_share_pct', 'cur_share_pct'].join('\t'),
      ...rows.map((b) =>
        [b.key, fmtRange(b), b.diffPct == null ? '' : b.diffPct.toFixed(2), b.refShare.toFixed(2), b.curShare.toFixed(2)].join('\t'),
      ),
      ['shape_diff', '', result.shapeDiffPct == null ? '' : result.shapeDiffPct.toFixed(2), '', ''].join('\t'),
    ]
    void navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <FloatingWindow title={t('Cmp_Title')} x={pos.x} y={pos.y} width={430} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="field-row" style={{ gap: 6 }}>
          <ToggleButton onClick={saveReference} title={t('Cmp_SaveRefTip')} style={{ flex: 1 }}>
            {t('Cmp_SaveRef')}
          </ToggleButton>
          <ToggleButton onClick={saveAndCompare} title={t('Cmp_CompareTip')} style={{ flex: 1 }}>
            {t('Cmp_Compare')}
          </ToggleButton>
        </div>

        <div style={{ fontSize: 11, color: 'rgb(70,70,70)' }}>
          {reference ? (
            <>
              {t('Cmp_Reference')}: {fmtTime(reference.time)}
              {current && (
                <>
                  {' · '}
                  {t('Cmp_Current')}: {fmtTime(current.time)}
                </>
              )}
              <span style={{ float: 'right' }}>
                <a href="#" onClick={(e) => (e.preventDefault(), clearReference())}>
                  {t('Cmp_Clear')}
                </a>
              </span>
            </>
          ) : (
            t('Cmp_NoReference')
          )}
        </div>

        {result && (
          <table className="compare-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgb(170,170,170)' }}>
                <th style={{ textAlign: 'left' }}>{t('Cmp_Band')}</th>
                <th style={{ textAlign: 'right' }}>nm</th>
                <th style={{ textAlign: 'right' }} title={t('Cmp_DiffTip')}>
                  {t('Cmp_Diff')}
                </th>
                <th style={{ textAlign: 'right' }} title={t('Cmp_ShareTip')}>
                  {t('Cmp_ShareRef')}
                </th>
                <th style={{ textAlign: 'right' }} title={t('Cmp_ShareTip')}>
                  {t('Cmp_ShareCur')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const color = b.diffPct == null || Math.abs(b.diffPct) < 0.05 ? undefined : b.diffPct > 0 ? 'rgb(0,120,0)' : b.diffPct < 0 ? 'rgb(190,0,0)' : undefined
                const isTotal = b.key === 'Total'
                return (
                  <tr key={b.key} style={isTotal ? { fontWeight: 'bold', borderBottom: '1px solid rgb(210,210,210)' } : undefined}>
                    <td>{t(BAND_LABEL[b.key])}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRange(b)}</td>
                    <td style={{ textAlign: 'right', color }}>{fmtPct(b.diffPct, true)}</td>
                    <td style={{ textAlign: 'right' }}>{isTotal ? '' : fmtPct(b.refShare)}</td>
                    <td style={{ textAlign: 'right' }}>{isTotal ? '' : fmtPct(b.curShare)}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '1px solid rgb(170,170,170)' }}>
                <td colSpan={2} title={t('Cmp_ShapeTip')}>
                  {t('Cmp_Shape')}
                </td>
                <td style={{ textAlign: 'right' }} title={t('Cmp_ShapeTip')}>
                  {fmtPct(result.shapeDiffPct)}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}

        {uncalibrated && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{t('Cmp_Uncalibrated')}</div>}
        {calibrationDiffers && <div style={{ color: 'rgb(160,90,0)', fontSize: 11 }}>{t('Cmp_CalDiffers')}</div>}

        <div className="field-row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
          <label>
            <input
              type="checkbox"
              checked={settings.CompareOverlay}
              onChange={(e) => setSettings({ CompareOverlay: e.target.checked })}
            />
            {t('Cmp_Overlay')}
          </label>
          {result && (
            <ToggleButton onClick={copy}>{copied ? t('Cmp_Copied') : t('Cmp_Copy')}</ToggleButton>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'rgb(120,120,120)' }}>{t('Cmp_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
