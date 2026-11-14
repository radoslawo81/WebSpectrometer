// AS7331 UV sensor window (web-only): live UVA / UVB / UVC irradiance over Web Serial
import { useMemo } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { downloadText } from '../core/files'
import { formatIrradiance, useUv, uvClear, uvConnect, uvDisconnect, uvRowsToCsv, uvSend, uvStats } from '../app/uvStore'
import { currentLight } from '../app/lightStore'
import type { UvReading } from '../serial/uvSensor'
import { useWindowPos } from './useWindowPos'

const CHANNELS = [
  { key: 'uva', label: 'UVA', band: '315–400 nm', color: '#7e4cc2' },
  { key: 'uvb', label: 'UVB', band: '280–315 nm', color: '#5a2d8a' },
  { key: 'uvc', label: 'UVC', band: '200–280 nm', color: '#3b1f5c' },
] as const

const GAINS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
const CONV = [1, 2, 4, 8, 16, 32, 64]
const PERIODS = [100, 250, 500, 1000, 2000, 5000, 10000, 60000]

const val = (r: UvReading, c: number) => (c === 0 ? r.uva : c === 1 ? r.uvb : r.uvc)

// Small line chart of the last readings of one channel (log scale, 0.001 µW/cm² floor)
function Spark({ rows, c, color }: { rows: UvReading[]; c: number; color: string }) {
  const W = 120
  const H = 28
  const pts = rows.slice(-120)
  if (pts.length < 2) return <svg width={W} height={H} aria-label="trend" />
  const ys = pts.map((r) => Math.log10(Math.max(1e-3, val(r, c))))
  let lo = Math.min(...ys)
  let hi = Math.max(...ys)
  if (hi - lo < 0.3) {
    const m = (hi + lo) / 2
    lo = m - 0.15
    hi = m + 0.15
  }
  const d = ys
    .map((y, i) => `${i ? 'L' : 'M'}${((i / (ys.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((y - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`)
    .join('')
  return (
    <svg width={W} height={H} aria-label="trend">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

export function UvSensorWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('uvsensor', { x: 420, y: 120 })
  const uv = useUv()
  const r = uv.last
  const sinceReset = useMemo(() => uv.rows.filter((x) => x.t >= uv.resetAt), [uv.rows, uv.resetAt])
  const st = uvStats(sinceReset)
  const stale = r ? Date.now() - r.t > 5000 : false
  const L = currentLight()
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator

  const fmt = (x: number) => {
    const f = formatIrradiance(x)
    return `${f.value} ${f.unit}`
  }

  return (
    <FloatingWindow title={t('Uv_Title')} x={pos.x} y={pos.y} width={460} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {uv.connected ? (
            <ToggleButton onClick={() => void uvDisconnect()}>{t('Uv_Disconnect')}</ToggleButton>
          ) : (
            <ToggleButton onClick={() => void uvConnect()} title={t('Uv_ConnectTip')}>
              {uv.connecting ? t('Uv_Connecting') : t('Uv_Connect')}
            </ToggleButton>
          )}
          <span style={{ fontSize: 11, color: uv.connected ? 'rgb(0,110,0)' : 'var(--text-muted)' }}>
            {uv.connected
              ? uv.info
                ? `${uv.info.model} ${uv.info.addr ?? ''}${uv.info.sda != null ? ` · SDA ${uv.info.sda} / SCL ${uv.info.scl}` : ''}`
                : t('Uv_Waiting')
              : t('Uv_NotConnected')}
          </span>
        </div>
        {!supported && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{t('Uv_NoSerial')}</div>}
        {uv.message && <div style={{ fontSize: 11, color: uv.messageIsError ? 'rgb(190,0,0)' : 'var(--text-muted)' }}>{uv.message}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: stale ? 0.5 : 1 }}>
          {CHANNELS.map((ch, c) => {
            const f = r ? formatIrradiance(val(r, c)) : null
            return (
              <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border, #ddd)', borderRadius: 6, padding: '4px 8px' }}>
                <div style={{ width: 56 }}>
                  <div style={{ background: ch.color, color: '#fff', borderRadius: 4, textAlign: 'center', fontWeight: 700, padding: '2px 0' }}>{ch.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>{ch.band}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f ? f.value : '—'}</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{f ? f.unit : ''}</span>
                  {st && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      min {fmt(st.min[c])} · {t('Uv_Mean')} {fmt(st.mean[c])} · max {fmt(st.max[c])}
                    </div>
                  )}
                </div>
                <Spark rows={sinceReset} c={c} color={ch.color} />
              </div>
            )
          })}
        </div>

        {r && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('Uv_Gain')} {r.gain}× · {r.convMs} ms · {r.tempC != null ? `${r.tempC.toFixed(1)} °C` : ''} · {t('Uv_Samples').replace('{n}', String(st?.n ?? 0))}
            {r.flag === 'S' && <span style={{ color: 'rgb(190,0,0)', fontWeight: 600 }}> · {t('Uv_Saturated')}</span>}
            {r.flag === 'L' && <span> · {t('Uv_Low')}</span>}
            {stale && <span style={{ color: 'rgb(190,0,0)' }}> · {t('Uv_Stale')}</span>}
          </div>
        )}

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>{t('Uv_Gain')}</span>
          <select
            disabled={!uv.connected}
            value={uv.info?.auto === false && uv.info.gain ? String(uv.info.gain) : 'A'}
            onChange={(e) => uvSend(e.target.value === 'A' ? 'A' : `G${e.target.value}`)}
          >
            <option value="A">{t('Uv_Auto')}</option>
            {GAINS.map((g) => (
              <option key={g} value={g}>
                {g}×
              </option>
            ))}
          </select>
          <span title={t('Uv_ConvTip')}>{t('Uv_Conv')}</span>
          <select disabled={!uv.connected} value={String(uv.info?.conv ?? 64)} onChange={(e) => uvSend(`T${e.target.value}`)}>
            {CONV.map((c) => (
              <option key={c} value={c}>
                {c} ms
              </option>
            ))}
          </select>
          <span>{t('Uv_Period')}</span>
          <select disabled={!uv.connected} value={String(uv.info?.period ?? 250)} onChange={(e) => uvSend(`P${e.target.value}`)}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p >= 1000 ? `${p / 1000} s` : `${p} ms`}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <ToggleButton onClick={uvClear} title={t('Uv_ClearTip')}>
            {t('Uv_Clear')}
          </ToggleButton>
          <ToggleButton onClick={() => sinceReset.length && downloadText('uv_sensor_log.csv', uvRowsToCsv(sinceReset))}>{t('Uv_SaveCsv')}</ToggleButton>
        </div>

        {L.uva && r && (
          <div style={{ fontSize: 11 }}>
            {t('Uv_Compare')
              .replace('{s}', `${L.uva.percent.toFixed(L.uva.percent < 10 ? 2 : 1)} %${L.corrected ? '' : ' *'}`)
              .replace('{a}', fmt(r.uva))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Uv_Hint')}</div>
        <div style={{ fontSize: 11, color: 'rgb(160,90,0)' }}>{t('Uv_Safety')}</div>
      </div>
    </FloatingWindow>
  )
}
