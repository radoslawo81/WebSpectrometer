// AS7265x spectral triad window (web-only): 18 channels 410–940 nm over the shared sensor-board link
import { useMemo, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { downloadText } from '../core/files'
import { wavelengthToCss } from '../core/wavelengthColor'
import { loadDataIntoPipeline } from '../app/engine'
import { setRuntime } from '../app/store'
import { calibrateResponseFromCurrent } from '../app/lightStore'
import { formatIrradiance, triadAverage, triadClear, triadRowsToCsv, useUv, uvConnect, uvDisconnect, uvSend } from '../app/uvStore'
import type { TriadReading } from '../serial/uvSensor'
import { useWindowPos } from './useWindowPos'

const GAINS = ['1', '3.7', '16', '64']
const GAIN_CMD: Record<string, string> = { '1': '1', '3.7': '4', '16': '16', '64': '64' }
const CYCLES = [10, 18, 36, 50, 100, 180, 255] // × 2.8 ms
const AVG_N = 10

// Bar chart of the 18 channels on a wavelength axis
function Bars({ r, log }: { r: TriadReading; log: boolean }) {
  const W = 440
  const H = 170
  const L = 34
  const B = 22
  const nmLo = 390
  const nmHi = 960
  const x = (nm: number) => L + ((nm - nmLo) / (nmHi - nmLo)) * (W - L - 6)
  const vmax = Math.max(...r.values, 1e-6)
  const vminLog = Math.max(vmax / 1e4, 1e-3)
  const y = (v: number) => {
    const f = log ? (Math.log10(Math.max(v, vminLog)) - Math.log10(vminLog)) / (Math.log10(vmax) - Math.log10(vminLog) || 1) : v / vmax
    return H - B - Math.max(0, Math.min(1, f)) * (H - B - 8)
  }
  const bw = x(410) - x(400) // 10 nm wide bars (channels are ~20 nm FWHM)
  return (
    <svg width={W} height={H} aria-label="AS7265x channels" style={{ background: '#fff', border: '1px solid var(--border, #ddd)', borderRadius: 6 }}>
      {[400, 500, 600, 700, 800, 900].map((nm) => (
        <g key={nm}>
          <line x1={x(nm)} x2={x(nm)} y1={8} y2={H - B} stroke="#e8e8e8" />
          <text x={x(nm)} y={H - 7} fontSize={10} textAnchor="middle" fill="#666">
            {nm}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - 6} y1={H - B} y2={H - B} stroke="#999" />
      <text x={4} y={14} fontSize={10} fill="#666">
        {formatIrradiance(vmax).value}
      </text>
      <text x={4} y={26} fontSize={9} fill="#999">
        {formatIrradiance(vmax).unit}
      </text>
      {r.values.map((v, i) => {
        const nm = r.nm[i]
        const top = y(v)
        const f = formatIrradiance(v)
        return (
          <rect key={nm} x={x(nm) - bw / 2} y={top} width={bw} height={H - B - top} fill={wavelengthToCss(Math.min(nm, 780))} opacity={nm > 700 ? 0.75 : 1}>
            <title>{`${nm} nm: ${f.value} ${f.unit}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

export function TriadWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('triad', { x: 460, y: 140 })
  const uv = useUv()
  const [log, setLog] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const r = uv.triadLast
  const info = uv.triadInfo
  const sinceReset = useMemo(() => uv.triadRows.filter((x) => x.t >= uv.triadResetAt), [uv.triadRows, uv.triadResetAt])
  const avg = triadAverage(sinceReset, AVG_N)
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator

  // Spectrum on a 1 nm grid (linear interpolation between the channel centres)
  const grid = (a: TriadReading) => {
    const nms: number[] = []
    const vals: number[] = []
    for (let nm = a.nm[0]; nm <= a.nm[a.nm.length - 1]; nm++) {
      let j = 0
      while (j < a.nm.length - 2 && a.nm[j + 1] < nm) j++
      const f = (nm - a.nm[j]) / (a.nm[j + 1] - a.nm[j])
      nms.push(nm)
      vals.push(a.values[j] * (1 - f) + a.values[j + 1] * f)
    }
    return { nms, vals }
  }

  const showInGraph = () => {
    if (!avg) return
    const g = grid(avg)
    loadDataIntoPipeline(g.nms, g.vals)
    setRuntime({ fileMode: 'AS7265x', fileMeta: [] })
    setMsg(t('Tri_Shown'))
  }

  const calibrate = () => {
    if (!avg) return
    if (avg.flag === 'S') return setMsg(t('Tri_ErrSaturated'))
    const err = calibrateResponseFromCurrent({
      kind: 'file',
      ref: { name: 'AS7265x', nms: avg.nm, values: avg.values },
      maskAtmosphere: false,
    })
    setMsg(err ? t(err) : t('Tri_Calibrated'))
  }

  return (
    <FloatingWindow title={t('Tri_Title')} x={pos.x} y={pos.y} width={460} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {uv.connected ? (
            <ToggleButton onClick={() => void uvDisconnect()}>{t('Uv_Disconnect')}</ToggleButton>
          ) : (
            <ToggleButton onClick={() => void uvConnect()} title={t('Uv_ConnectTip')}>
              {uv.connecting ? t('Uv_Connecting') : t('Uv_Connect')}
            </ToggleButton>
          )}
          <span style={{ fontSize: 11, color: uv.connected ? (info ? 'rgb(0,110,0)' : 'rgb(160,90,0)') : 'var(--text-muted)' }}>
            {uv.connected
              ? info
                ? `AS7265x${info.sda != null ? ` · SDA ${info.sda} / SCL ${info.scl}` : ''}`
                : t('Tri_NoTriad')
              : t('Uv_NotConnected')}
          </span>
        </div>
        {!supported && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{t('Uv_NoSerial')}</div>}
        {uv.message && <div style={{ fontSize: 11, color: uv.messageIsError ? 'rgb(190,0,0)' : 'var(--text-muted)' }}>{uv.message}</div>}

        {r ? <Bars r={r} log={log} /> : <div style={{ height: 60, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>{t('Tri_Waiting')}</div>}

        {r && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('Uv_Gain')} {r.gain}× · {t('Tri_Int')} {r.intMs.toFixed(0)} ms · {r.tempC != null ? `${r.tempC.toFixed(1)} °C` : ''} ·{' '}
            {t('Uv_Samples').replace('{n}', String(sinceReset.length))}
            {r.flag === 'S' && <span style={{ color: 'rgb(190,0,0)', fontWeight: 600 }}> · {t('Uv_Saturated')}</span>}
            {r.flag === 'L' && <span> · {t('Uv_Low')}</span>}
          </div>
        )}

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>{t('Uv_Gain')}</span>
          <select
            disabled={!info}
            value={info?.auto === false && info.gain != null ? String(info.gain) : 'A'}
            onChange={(e) => uvSend(e.target.value === 'A' ? 'SA' : `SG${GAIN_CMD[e.target.value]}`)}
          >
            <option value="A">{t('Uv_Auto')}</option>
            {GAINS.map((g) => (
              <option key={g} value={g}>
                {g}×
              </option>
            ))}
          </select>
          <span>{t('Tri_Int')}</span>
          <select disabled={!info} value={String(info?.cycles ?? 50)} onChange={(e) => uvSend(`SN${e.target.value}`)}>
            {CYCLES.map((c) => (
              <option key={c} value={c}>
                {(c * 2.8).toFixed(0)} ms
              </option>
            ))}
          </select>
          <span title={t('Tri_LedTip')}>{t('Tri_Led')}</span>
          {(['W', 'I', 'U'] as const).map((k, i) => (
            <ToggleButton key={k} disabled={!info} active={!!info?.led[i]} onClick={() => uvSend(`SL${k}${info?.led[i] ? 0 : 1}`)} title={t(`Tri_Led${k}`)}>
              {k === 'W' ? t('Tri_LedWs') : k === 'I' ? 'IR' : 'UV'}
            </ToggleButton>
          ))}
        </div>

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> {t('Tri_Log')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> {t('Tri_Table')}
          </label>
          <div style={{ flex: 1 }} />
          <ToggleButton onClick={triadClear}>{t('Uv_Clear')}</ToggleButton>
          <ToggleButton onClick={() => sinceReset.length && downloadText('as7265x_log.csv', triadRowsToCsv(sinceReset))}>{t('Uv_SaveCsv')}</ToggleButton>
        </div>

        {showTable && r && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px 10px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {r.values.map((v, i) => {
              const f = formatIrradiance(v)
              return (
                <div key={r.nm[i]} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: wavelengthToCss(Math.min(r.nm[i], 780)), fontWeight: 600 }}>{r.nm[i]} nm</span>
                  <span>
                    {f.value} {f.unit}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <ToggleButton disabled={!avg} onClick={showInGraph} title={t('Tri_ShowTip')}>
            {t('Tri_Show')}
          </ToggleButton>
          <ToggleButton disabled={!avg} onClick={calibrate} title={t('Tri_CalTip')}>
            {t('Tri_Cal')}
          </ToggleButton>
        </div>
        {msg && <div style={{ fontSize: 11 }}>{msg}</div>}
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Tri_Hint').replace('{n}', String(AVG_N))}</div>
      </div>
    </FloatingWindow>
  )
}
