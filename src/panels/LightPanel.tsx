// Always-visible compact Light quality panel (web-only). Same numbers as the Light window,
// which stays available for R1–R14 and the response / lux calibrations.
import { useEffect, useState } from 'react'
import { setSettings, useAppState } from '../app/store'
import { useT } from '../i18n'
import { currentLight, getLux, useLight, type CurrentLight } from '../app/lightStore'
import { ToggleButton } from '../components/ToggleButton'

const CRI_DUV_LIMIT = 0.0054
const fmt = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))

// Approximate display colour of the light from its CIE 1931 x, y (normalised brightness)
function xyToCss(x: number, y: number): string {
  if (!(y > 0)) return 'transparent'
  const X = x / y
  const Z = (1 - x - y) / y
  let r = 3.2406 * X - 1.5372 - 0.4986 * Z
  let g = -0.9689 * X + 1.8758 + 0.0415 * Z
  let b = 0.0557 * X - 0.204 + 1.057 * Z
  r = Math.max(0, r)
  g = Math.max(0, g)
  b = Math.max(0, b)
  const m = Math.max(r, g, b) || 1
  const gam = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
  return `rgb(${gam(r / m)},${gam(g / m)},${gam(b / m)})`
}

function Tile({ label, value, unit, title, big }: { label: string; value: string; unit?: string; title?: string; big?: boolean }) {
  return (
    <div
      title={title}
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 3,
        padding: '3px 6px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: big ? 20 : 15, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
        {value}
        {unit && value !== '—' && <span style={{ fontSize: 11, fontWeight: 'normal' }}> {unit}</span>}
      </div>
    </div>
  )
}

export function LightPanel() {
  const t = useT()
  const { runtime, settings } = useAppState()
  const { response, lux } = useLight()
  const [cur, setCur] = useState<CurrentLight>(() => currentLight())

  useEffect(() => {
    const id = setInterval(() => setCur(currentLight()), 500)
    return () => clearInterval(id)
  }, [])
  useEffect(() => setCur(currentLight()), [response, lux.factor])

  const m = cur.metrics
  const luxValue = m && cur.corrected ? getLux(m.photometricSum) : null
  const criValid = m?.duv != null && Math.abs(m.duv) < CRI_DUV_LIMIT
  const star = criValid ? '' : ' *'

  const warnings: string[] = []
  if (!cur.calibrated) warnings.push(t('Lq_WarnNoWl'))
  else {
    if (cur.calibrationSuspect) warnings.push(t('Lq_WarnBadWl'))
    if (!cur.corrected) warnings.push(t('Lq_WarnNoResponse'))
  }
  if (cur.saturated && runtime.connected) warnings.push(t('Lq_WarnSaturated'))
  if (m?.duv != null && !criValid) warnings.push(t('Lq_WarnDuv'))

  return (
    <div className="group-box" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div className="group-box-title">{t('Lq_Title')}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <div
          title="x, y (CIE 1931)"
          style={{
            width: 46,
            flexShrink: 0,
            borderRadius: 3,
            border: '1px solid rgb(150,150,150)',
            background: m ? xyToCss(m.x, m.y) : 'transparent',
          }}
        />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 4, minWidth: 0 }}>
          <Tile big label={t('Lq_CCT')} value={m?.cct ? fmt(m.cct) : '—'} unit="K" title={t('Lq_CCTTip')} />
          <Tile big label="CRI Ra" value={m?.cri ? fmt(m.cri.Ra, 1) + star : '—'} title={t('Lq_RaTip')} />
          <Tile big label={t('Lq_Lux')} value={luxValue != null ? fmt(luxValue, luxValue < 100 ? 1 : 0) : '—'} unit="lx" title={t('Lq_LuxTip')} />
          <Tile label="R9" value={m?.cri ? fmt(m.cri.Ri[8], 1) + star : '—'} title={t('Lq_R9Tip')} />
          <Tile label="Duv" value={fmt(m?.duv, 4)} title={t('Lq_DuvTip')} />
          <Tile label="x, y" value={m ? `${fmt(m.x, 4)}, ${fmt(m.y, 4)}` : '—'} />
          <Tile label={t('Lq_LER')} value={m ? fmt(m.ler) : '—'} unit="lm/W" title={t('Lq_LERTip')} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        <div style={{ flex: 1, fontSize: 11, color: 'rgb(170,0,0)', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          {warnings.slice(0, 2).map((w) => (
            <span key={w} title={w} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {w}
            </span>
          ))}
        </div>
        <ToggleButton
          active={settings.LightVisible}
          title={t('Lq_DetailsTip')}
          onClick={() => setSettings({ LightVisible: !settings.LightVisible })}
        >
          {t('Lq_Details')}
        </ToggleButton>
      </div>
    </div>
  )
}
