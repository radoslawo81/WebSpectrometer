// Light quality floating window (web-only): CCT, Duv, CRI (Ra, R1–R14), LER, lux / cd / lx·W⁻¹,
// spectral response calibration from a halogen lamp and lux calibration against a lux meter.
import { useCallback, useEffect, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useAppState } from '../app/store'
import { useT } from '../i18n'
import { calibrateResponseFromCurrent, currentLight, setLux, setResponse, useLight, type CurrentLight } from '../app/lightStore'
import {
  referenceFromText,
  responseFromText,
  responseSourceLabel,
  responseToText,
  type ReferenceSpec,
  type ReferenceSpectrum,
} from '../core/responseCal'
import { downloadText, pickFile } from '../core/files'

const POS_KEY = 'webspectrometer.lightWindowPos'
const CRI_DUV_LIMIT = 0.0054 // CIE 13.3: CRI not meaningful farther from the Planckian locus

const SRC_KEY = 'webspectrometer.responseSource'

// Calibration sources: Planck presets (typical colour temperatures at full voltage), custom T, reference file
const SOURCES: { id: string; label: string; T?: number }[] = [
  { id: 'incand', label: 'Lq_SrcIncand', T: 2700 },
  { id: 'halogen230', label: 'Lq_SrcHalogen230', T: 2900 },
  { id: 'halogen12', label: 'Lq_SrcHalogen12', T: 3000 },
  { id: 'illA', label: 'Lq_SrcIllA', T: 2856 },
  { id: 'custom', label: 'Lq_SrcCustom' },
  { id: 'file', label: 'Lq_SrcFile' },
]

function loadSource(): string {
  try {
    const s = localStorage.getItem(SRC_KEY)
    if (s && SOURCES.some((x) => x.id === s)) return s
  } catch {
    // ignore
  }
  return 'illA'
}

const fmt = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))

function NumInput({ value, onChange, width = 70, placeholder }: { value: number | null; onChange: (v: number | null) => void; width?: number; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  return (
    <input
      className="text-box"
      style={{ width }}
      value={text}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = Number.parseFloat(text.replace(',', '.'))
        onChange(Number.isFinite(v) && v > 0 ? v : null)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function LightWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { runtime } = useAppState()
  const { response, lux } = useLight()
  const [pos, setPos] = useState({ x: 380, y: 110 })
  const [cur, setCur] = useState<CurrentLight>(() => currentLight())
  const [lampT, setLampT] = useState<number | null>(2856)
  const [source, setSourceState] = useState<string>(loadSource)
  const [refSpec, setRefSpec] = useState<ReferenceSpectrum | null>(null)
  const [maskAtmo, setMaskAtmo] = useState(true)
  const setSource = (s: string) => {
    setSourceState(s)
    try {
      localStorage.setItem(SRC_KEY, s)
    } catch {
      // ignore
    }
  }
  const srcDef = SOURCES.find((s) => s.id === source) ?? SOURCES[3]
  const [luxMeter, setLuxMeter] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [msg, setMsg] = useState('')

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

  // Live update, 2× per second
  useEffect(() => {
    const id = setInterval(() => setCur(currentLight()), 500)
    return () => clearInterval(id)
  }, [])
  useEffect(() => setCur(currentLight()), [response])

  const m = cur.metrics
  const luxValue = m && lux.factor && cur.corrected ? lux.factor * m.photometricSum : null
  const luxStale = lux.factor != null && lux.responseTime !== (response?.time ?? null)
  const criValid = m?.duv != null && Math.abs(m.duv) < CRI_DUV_LIMIT
  const partial = m && (m.coverage[0] > 380 || m.coverage[1] < 780)

  const doResponseCal = () => {
    let spec: ReferenceSpec
    if (source === 'file') {
      if (!refSpec) return setMsg(t('Lq_NeedRef'))
      spec = { kind: 'file', ref: refSpec, maskAtmosphere: maskAtmo }
    } else {
      const T = srcDef.T ?? lampT
      if (!T) return setMsg(t('Lq_EnterLampT'))
      spec = { kind: 'planck', T }
    }
    const err = calibrateResponseFromCurrent(spec)
    setMsg(err ? t(err) : t('Lq_ResponseDone'))
  }
  const loadRef = async () => {
    const f = await pickFile('.txt,.csv,.dat')
    if (!f) return
    const r = referenceFromText(await f.text(), f.name)
    if (typeof r === 'string') setMsg(t(r))
    else {
      setRefSpec(r)
      setMsg(t('Lq_RefLoaded'))
    }
  }
  const doLuxCal = () => {
    if (!luxMeter) return setMsg(t('Lq_EnterLux'))
    if (!m || !cur.corrected) return setMsg(t('Lq_NeedResponse'))
    setLux({ factor: luxMeter / m.photometricSum, responseTime: response?.time ?? null })
    setMsg(t('Lq_LuxDone'))
  }
  const loadResp = async () => {
    const f = await pickFile('.txt')
    if (!f) return
    const r = responseFromText(await f.text())
    if (typeof r === 'string') setMsg(t(r))
    else {
      setResponse(r)
      setMsg(t('Lq_ResponseLoaded'))
    }
  }

  const row = (label: string, value: string, title?: string, strong = false) => (
    <tr title={title}>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontWeight: strong ? 'bold' : undefined }}>{value}</td>
    </tr>
  )

  return (
    <FloatingWindow title={t('Lq_Title')} x={pos.x} y={pos.y} width={420} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        {/* Results */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {row(t('Lq_CCT'), m?.cct ? `${fmt(m.cct)} K` : '—', t('Lq_CCTTip'), true)}
            {row('Duv', fmt(m?.duv, 4), t('Lq_DuvTip'))}
            {row('x, y (CIE 1931)', m ? `${fmt(m.x, 4)}, ${fmt(m.y, 4)}` : '—')}
            {row('CRI Ra', m?.cri ? `${fmt(m.cri.Ra, 1)}${criValid ? '' : ' *'}` : '—', t('Lq_RaTip'), true)}
            {row('R9', m?.cri ? `${fmt(m.cri.Ri[8], 1)}${criValid ? '' : ' *'}` : '—', t('Lq_R9Tip'))}
            {row(t('Lq_LER'), m ? `${fmt(m.ler)} lm/W` : '—', t('Lq_LERTip'))}
            {row(t('Lq_Lux'), luxValue != null ? `${fmt(luxValue, luxValue < 100 ? 1 : 0)} lx` : '—', t('Lq_LuxTip'), true)}
            {lux.distance != null && row(t('Lq_Cd'), luxValue != null ? `${fmt(luxValue * lux.distance * lux.distance, 0)} cd` : '—', t('Lq_CdTip'))}
            {lux.watts != null && row(t('Lq_LxW'), luxValue != null ? `${fmt(luxValue / lux.watts, 1)} lx/W` : '—', t('Lq_LxWTip'))}
          </tbody>
        </table>

        {m?.cri && (
          <div>
            <a href="#" onClick={(e) => (e.preventDefault(), setShowAll((v) => !v))} style={{ fontSize: 11 }}>
              {showAll ? t('Lq_HideRi') : t('Lq_ShowRi')}
            </a>
            {showAll && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginTop: 4, fontSize: 11 }}>
                {m.cri.Ri.map((r, i) => (
                  <div key={i} style={{ textAlign: 'center', background: 'var(--surface-2)', border: '1px solid rgb(210,210,210)' }}>
                    R{i + 1}
                    <br />
                    <b>{r.toFixed(0)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!cur.calibrated && <span style={{ color: 'rgb(190,0,0)' }}>{t('Lq_WarnNoWl')}</span>}
          {cur.calibrationSuspect && <span style={{ color: 'rgb(190,0,0)' }}>{t('Lq_WarnBadWl')}</span>}
          {cur.calibrated && !cur.corrected && <span style={{ color: 'rgb(190,0,0)' }}>{t('Lq_WarnNoResponse')}</span>}
          {cur.saturated && runtime.connected && <span style={{ color: 'rgb(190,0,0)' }}>{t('Lq_WarnSaturated')}</span>}
          {partial && m && (
            <span style={{ color: 'rgb(160,90,0)' }}>
              {t('Lq_WarnCoverage').replace('{range}', `${m.coverage[0]}–${m.coverage[1]}`)}
            </span>
          )}
          {m?.duv != null && !criValid && <span style={{ color: 'rgb(160,90,0)' }}>{t('Lq_WarnDuv')}</span>}
          {luxStale && <span style={{ color: 'rgb(160,90,0)' }}>{t('Lq_WarnLuxStale')}</span>}
        </div>

        {/* Response calibration */}
        <fieldset style={{ border: '1px solid var(--border)', padding: '4px 6px' }}>
          <legend style={{ fontSize: 11 }}>{t('Lq_ResponseTitle')}</legend>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <span>{t('Lq_Source')}</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} title={t('Lq_SourceTip')}>
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {t(s.label)}
                </option>
              ))}
            </select>
            {source === 'custom' && (
              <>
                <NumInput value={lampT} onChange={setLampT} width={60} />
                <span>K</span>
              </>
            )}
            {source === 'file' && (
              <ToggleButton onClick={() => void loadRef()} title={t('Lq_LoadRefTip')}>
                {t('Lq_LoadRef')}
              </ToggleButton>
            )}
          </div>
          {source === 'file' && (
            <div className="field-row" style={{ flexWrap: 'wrap', fontSize: 11 }}>
              <span style={{ color: refSpec ? undefined : 'var(--text-muted)' }}>
                {refSpec
                  ? `${refSpec.name} (${Math.round(refSpec.nms[0])}–${Math.round(refSpec.nms[refSpec.nms.length - 1])} nm)`
                  : t('Lq_NoRef')}
              </span>
              <label title={t('Lq_MaskAtmoTip')} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input type="checkbox" checked={maskAtmo} onChange={(e) => setMaskAtmo(e.target.checked)} />
                {t('Lq_MaskAtmo')}
              </label>
            </div>
          )}
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <ToggleButton onClick={doResponseCal} title={t(source === 'file' ? 'Lq_ResponseTipRef' : 'Lq_ResponseTip')}>
              {t('Lq_Calibrate')}
            </ToggleButton>
            <div style={{ flex: 1 }} />
            <ToggleButton onClick={() => response && downloadText('response_calibration.txt', responseToText(response))}>{t('Lq_Save')}</ToggleButton>
            <ToggleButton onClick={() => void loadResp()}>{t('Lq_Load')}</ToggleButton>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {response ? (
              <>
                {t('Lq_ResponseStatus')
                  .replace('{range}', `${response.validLo}–${response.validHi}`)
                  .replace('{T}', responseSourceLabel(response))
                  .replace('{time}', new Date(response.time).toLocaleString())}{' '}
                <a href="#" onClick={(e) => (e.preventDefault(), setResponse(null))}>
                  {t('Lq_Clear')}
                </a>
              </>
            ) : (
              t(source === 'file' ? 'Lq_RefHint' : 'Lq_ResponseHint')
            )}
          </div>
        </fieldset>

        {/* Lux calibration */}
        <fieldset style={{ border: '1px solid var(--border)', padding: '4px 6px' }}>
          <legend style={{ fontSize: 11 }}>{t('Lq_LuxTitle')}</legend>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <span>{t('Lq_LuxMeter')}</span>
            <NumInput value={luxMeter} onChange={setLuxMeter} width={60} placeholder="lx" />
            <ToggleButton onClick={doLuxCal} title={t('Lq_LuxCalTip')}>
              {t('Lq_Calibrate')}
            </ToggleButton>
            {lux.factor != null && (
              <a href="#" onClick={(e) => (e.preventDefault(), setLux({ factor: null, responseTime: null }))} style={{ fontSize: 11 }}>
                {t('Lq_Clear')}
              </a>
            )}
          </div>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <span title={t('Lq_CdTip')}>{t('Lq_Distance')}</span>
            <NumInput value={lux.distance} onChange={(v) => setLux({ distance: v })} width={50} placeholder="m" />
            <span title={t('Lq_LxWTip')}>{t('Lq_Power')}</span>
            <NumInput value={lux.watts} onChange={(v) => setLux({ watts: v })} width={50} placeholder="W" />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Lq_LuxHint')}</div>
        </fieldset>

        {msg && <div style={{ fontSize: 11, color: 'var(--accent)' }}>{msg}</div>}
      </div>
    </FloatingWindow>
  )
}
