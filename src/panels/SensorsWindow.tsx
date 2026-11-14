// Sensor board window (web-only): AS7331 UV (UVA/UVB/UVC) + AS7265x spectral triad (18 channels 410–940 nm)
// over one shared Web Serial link, one combined bar chart 240–960 nm.
import { useMemo, useState, type CSSProperties } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { downloadText } from '../core/files'
import { wavelengthToCss } from '../core/wavelengthColor'
import { loadDataIntoPipeline } from '../app/engine'
import { calibrateResponseFromCurrent, currentLight } from '../app/lightStore'
import {
  formatIrradiance,
  triadAverage,
  triadClear,
  triadRowsToCsv,
  useUv,
  uvClear,
  uvConnect,
  uvDisconnect,
  uvRowsToCsv,
  uvSend,
  uvStats,
} from '../app/uvStore'
import type { UvReading } from '../serial/uvSensor'
import { barDensity, triadBarsOf, uvBarsOf, UV_CH, TRIAD_LETTERS, type SensorBar } from '../core/sensorBands'
import { setRuntime, setSettings, useAppState } from '../app/store'
import { useWindowPos } from './useWindowPos'
import { computeTriadCorr, parseTriadCorr } from '../core/triadCorr'

const UV_GAINS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
const UV_CONV = [1, 2, 4, 8, 16, 32, 64]
const PERIODS = [100, 250, 500, 1000, 2000, 5000, 10000, 60000]
const TRI_GAINS = ['1', '3.7', '16', '64']
const TRI_GAIN_CMD: Record<string, string> = { '1': '1', '3.7': '4', '16': '16', '64': '64' }
const TRI_CYCLES = [10, 18, 36, 50, 100, 180, 255] // × 2.8 ms
const AVG_N = 10

const uvVal = (r: UvReading, c: number) => (c === 0 ? r.uva : c === 1 ? r.uvb : r.uvc)
// UV rows in the window: UVA, UVB, UVC (top to bottom)
const UV_ROWS = [UV_CH[2], UV_CH[1], UV_CH[0]]

const barValue = (b: SensorBar, density: boolean) => (density ? barDensity(b) : b.v)

// Bar chart, one equal-width slot per channel, peak wavelength (datasheet) under every bar
function Chart({ bars, log, density }: { bars: SensorBar[]; log: boolean; density: boolean }) {
  const W = 760
  const H = 230
  const L = 44
  const T = 22 // room for the value labels
  const B = 34 // two label lines under the bars
  const slot = (W - L - 6) / bars.length
  const vals = bars.map((b) => barValue(b, density))
  const vmax = Math.max(...vals, 1e-6)
  const vminLog = Math.max(vmax / 1e4, 1e-4)
  const y = (v: number) => {
    const f = log ? (Math.log10(Math.max(v, vminLog)) - Math.log10(vminLog)) / (Math.log10(vmax) - Math.log10(vminLog) || 1) : v / vmax
    return H - B - Math.max(0, Math.min(1, f)) * (H - B - T)
  }
  const milli = vmax >= 1000
  const unit = `${milli ? 'mW' : 'µW'}/cm²${density ? '/nm' : ''}`
  const num = (v: number) => {
    const x = milli ? v / 1000 : v
    return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3)
  }
  const grid = log ? [1, 0.1, 0.01, 0.001] : [1, 0.75, 0.5, 0.25]
  return (
    <svg width={W} height={H} aria-label="sensor channels" style={{ background: '#fff', border: '1px solid var(--border, #ddd)', borderRadius: 6 }}>
      {grid.map((g) => {
        const v = vmax * g
        if (log && v < vminLog) return null
        const yy = y(v)
        return (
          <g key={g}>
            <line x1={L} x2={W - 6} y1={yy} y2={yy} stroke="#eee" />
            <text x={L - 4} y={yy + 3} fontSize={9} textAnchor="end" fill="#888">
              {num(v)}
            </text>
          </g>
        )
      })}
      <text x={4} y={12} fontSize={9} fill="#666">
        {unit}
      </text>
      <line x1={L} x2={W - 6} y1={H - B} y2={H - B} stroke="#999" />
      {bars.map((b, i) => {
        const v = vals[i]
        const top = y(v)
        const x0 = L + i * slot
        const cx = x0 + slot / 2
        const f = formatIrradiance(b.v)
        return (
          <g key={b.label}>
            <rect x={x0 + slot * 0.14} y={top} width={slot * 0.72} height={H - B - top} fill={b.color} opacity={!b.uv && b.c > 700 ? 0.75 : 1}>
              <title>{`${b.uv ? `${b.label} (${b.lo}–${b.hi} nm)` : `${b.sub}: ${b.c} nm`} – ${f.value} ${f.unit}`}</title>
            </rect>
            <text x={cx} y={top - 4} fontSize={9} textAnchor="middle" fill="#444">
              {num(v)}
            </text>
            <text x={cx} y={H - B + 13} fontSize={10} fontWeight={600} textAnchor="middle" fill={b.uv ? b.color : '#333'}>
              {b.label}
            </text>
            <text x={cx} y={H - B + 26} fontSize={9} textAnchor="middle" fill="#888">
              {b.uv ? `${b.c} nm` : b.sub}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Small trend line of one UV channel (log scale)
function Spark({ rows, c, color }: { rows: UvReading[]; c: number; color: string }) {
  const W = 90
  const H = 22
  const pts = rows.slice(-120)
  if (pts.length < 2) return <svg width={W} height={H} aria-label="trend" />
  const ys = pts.map((r) => Math.log10(Math.max(1e-3, uvVal(r, c))))
  let lo = Math.min(...ys)
  let hi = Math.max(...ys)
  if (hi - lo < 0.3) {
    const m = (hi + lo) / 2
    lo = m - 0.15
    hi = m + 0.15
  }
  const d = ys
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (ys.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`)
    .join('')
  return (
    <svg width={W} height={H} aria-label="trend">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function meanUv(rows: UvReading[], n: number): UvReading | null {
  const sel = rows.slice(-n)
  if (!sel.length) return null
  const m = (f: (r: UvReading) => number) => sel.reduce((a, r) => a + f(r), 0) / sel.length
  return { ...sel[sel.length - 1], uva: m((r) => r.uva), uvb: m((r) => r.uvb), uvc: m((r) => r.uvc) }
}

/** Spectral density points (nm, µW/cm²/nm) → 1 nm grid by linear interpolation */
function toGrid(points: { nm: number; v: number }[]) {
  const p = points.slice().sort((a, b) => a.nm - b.nm)
  const nms: number[] = []
  const vals: number[] = []
  let j = 0
  for (let nm = p[0].nm; nm <= p[p.length - 1].nm; nm++) {
    while (j < p.length - 2 && p[j + 1].nm < nm) j++
    const f = (nm - p[j].nm) / (p[j + 1].nm - p[j].nm)
    nms.push(nm)
    vals.push(p[j].v * (1 - f) + p[j + 1].v * f)
  }
  return { nms, vals }
}

export function SensorsWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('sensors', { x: 440, y: 120 })
  const uv = useUv()
  const { settings } = useAppState()
  const [log, setLog] = useState(false)
  const [density, setDensity] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [withUv, setWithUv] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [corrT, setCorrT] = useState('')
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator

  const ru = uv.last
  const rt = uv.triadLast
  const uvRows = useMemo(() => uv.rows.filter((x) => x.t >= uv.resetAt), [uv.rows, uv.resetAt])
  const triRows = useMemo(() => uv.triadRows.filter((x) => x.t >= uv.triadResetAt), [uv.triadRows, uv.triadResetAt])
  const st = uvStats(uvRows)
  const uvStale = ru ? Date.now() - ru.t > 5000 : false
  const hasUv = !!uv.info && !!ru
  const hasTri = !!uv.triadInfo && !!rt
  const bars = [...(hasUv ? uvBarsOf(ru) : []), ...(hasTri ? triadBarsOf(rt) : [])]
  const triAvg = triadAverage(triRows, AVG_N)
  const uvAvg = meanUv(uvRows, AVG_N)
  const L = currentLight()
  const corr = parseTriadCorr(settings.TriadCorr)
  const camT = L.corrected && L.metrics?.cct ? Math.round(L.metrics.cct) : null

  const calibrateTriad = () => {
    if (!triAvg?.factory) return
    if (triAvg.flag === 'S') return setMsg(t('Tri_ErrSaturated'))
    const T = Number.parseFloat(corrT || String(camT ?? 2700))
    const c = computeTriadCorr(triAvg.nm, triAvg.factory, T)
    if (typeof c === 'string') return setMsg(t(c))
    setSettings({ TriadCorr: JSON.stringify(c) })
    triadClear() // new readings come corrected; the old ones would mix both
    const bad = c.bad.map((i) => `${TRIAD_LETTERS[i]} ${triAvg.nm[i]} nm`).join(', ')
    setMsg(t('Tri_CorrDone').replace('{t}', String(T)) + (bad ? ' ' + t('Tri_CorrBad').replace('{c}', bad) : ''))
  }

  const fmt = (v: number) => {
    const f = formatIrradiance(v)
    return `${f.value} ${f.unit}`
  }

  const clearAll = () => {
    uvClear()
    triadClear()
  }

  const showInGraph = () => {
    const pts: { nm: number; v: number }[] = []
    if (withUv && hasUv && uvAvg) uvBarsOf(uvAvg).forEach((b) => pts.push({ nm: b.c, v: barDensity(b) }))
    if (hasTri && triAvg) triadBarsOf(triAvg).forEach((b) => pts.push({ nm: b.c, v: barDensity(b) }))
    if (pts.length < 2) return
    const g = toGrid(pts)
    loadDataIntoPipeline(g.nms, g.vals)
    setRuntime({ fileMode: hasTri ? (withUv && hasUv ? 'AS7331+AS7265x' : 'AS7265x') : 'AS7331', fileMeta: [] })
    setMsg(t('Tri_Shown'))
  }

  const calibrate = () => {
    if (!triAvg) return
    if (triAvg.flag === 'S') return setMsg(t('Tri_ErrSaturated'))
    const err = calibrateResponseFromCurrent({
      kind: 'file',
      ref: { name: 'AS7265x', nms: triAvg.nm, values: triAvg.values },
      maskAtmosphere: false,
    })
    setMsg(err ? t(err) : t('Tri_Calibrated'))
  }

  const saveCsv = () => {
    if (uvRows.length) downloadText('as7331_uv_log.csv', uvRowsToCsv(uvRows))
    if (triRows.length) downloadText('as7265x_log.csv', triadRowsToCsv(triRows))
  }

  const status = (ok: boolean, text: string) => <span style={{ color: ok ? 'rgb(0,110,0)' : 'var(--text-muted)' }}>{text}</span>
  const box: CSSProperties = { border: '1px solid var(--border, #ddd)', borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <FloatingWindow title={t('Sen_Title')} x={pos.x} y={pos.y} width={790} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {uv.connected ? (
            <ToggleButton onClick={() => void uvDisconnect()}>{t('Uv_Disconnect')}</ToggleButton>
          ) : (
            <ToggleButton onClick={() => void uvConnect()} title={t('Uv_ConnectTip')}>
              {uv.connecting ? t('Uv_Connecting') : t('Uv_Connect')}
            </ToggleButton>
          )}
          <span style={{ fontSize: 11 }}>
            {uv.connected ? (
              <>
                {status(!!uv.info, uv.info ? `AS7331 ${uv.info.addr ?? ''}` : 'AS7331 —')} · {status(!!uv.triadInfo, uv.triadInfo ? 'AS7265x' : 'AS7265x —')}
              </>
            ) : (
              status(false, t('Uv_NotConnected'))
            )}
          </span>
          <div style={{ flex: 1 }} />
          <span>{t('Uv_Period')}</span>
          <select disabled={!uv.connected} value={String(uv.info?.period ?? 250)} onChange={(e) => uvSend(`P${e.target.value}`)}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p >= 1000 ? `${p / 1000} s` : `${p} ms`}
              </option>
            ))}
          </select>
        </div>
        {!supported && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{t('Uv_NoSerial')}</div>}
        {uv.message && <div style={{ fontSize: 11, color: uv.messageIsError ? 'rgb(190,0,0)' : 'var(--text-muted)' }}>{uv.message}</div>}

        {bars.length ? (
          <Chart bars={bars} log={log} density={density} />
        ) : (
          <div style={{ height: 60, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>{uv.connected ? t('Sen_Waiting') : t('Uv_NotConnected')}</div>
        )}

        <div className="field-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={t('Sen_DensityTip')}>
            <input type="checkbox" checked={density} onChange={(e) => setDensity(e.target.checked)} /> {t('Sen_Density')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> {t('Tri_Log')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> {t('Tri_Table')}
          </label>
          <div style={{ flex: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={t('Sen_OverlayTip')}>
            <input type="checkbox" checked={settings.SensorOverlay} onChange={(e) => setSettings({ SensorOverlay: e.target.checked })} /> {t('Sen_Overlay')}
          </label>
          <select
            disabled={!settings.SensorOverlay}
            value={settings.SensorOverlayFit ? 'fit' : 'max'}
            onChange={(e) => setSettings({ SensorOverlayFit: e.target.value === 'fit' })}
            title={t('Sen_OverlayTip')}
          >
            <option value="fit">{t('Sen_FitCam')}</option>
            <option value="max">{t('Sen_FitMax')}</option>
          </select>
        </div>

        {/* ---- AS7331 UV ---- */}
        {uv.info && (
          <div style={{ ...box, opacity: uvStale ? 0.5 : 1 }}>
            <div style={{ fontWeight: 600 }}>{t('Uv_Title')}</div>
            {UV_ROWS.map((ch, c) => {
              const f = ru ? formatIrradiance(uvVal(ru, c)) : null
              return (
                <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 44, background: ch.color, color: '#fff', borderRadius: 4, textAlign: 'center', fontWeight: 700 }}>{ch.label}</div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f ? f.value : '—'}</span>{' '}
                    <span style={{ color: 'var(--text-muted)' }}>{f ? f.unit : ''}</span>
                    {st && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        min {fmt(st.min[c])} · {t('Uv_Mean')} {fmt(st.mean[c])} · max {fmt(st.max[c])}
                      </div>
                    )}
                  </div>
                  <Spark rows={uvRows} c={c} color={ch.color} />
                </div>
              )
            })}
            {ru && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {t('Uv_Gain')} {ru.gain}× · {ru.convMs} ms · {ru.tempC != null ? `${ru.tempC.toFixed(1)} °C` : ''} · {t('Uv_Samples').replace('{n}', String(st?.n ?? 0))}
                {ru.flag === 'S' && <span style={{ color: 'rgb(190,0,0)', fontWeight: 600 }}> · {t('Uv_Saturated')}</span>}
                {ru.flag === 'L' && <span> · {t('Uv_Low')}</span>}
                {uvStale && <span style={{ color: 'rgb(190,0,0)' }}> · {t('Uv_Stale')}</span>}
              </div>
            )}
            <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>{t('Uv_Gain')}</span>
              <select
                value={uv.info.auto === false && uv.info.gain ? String(uv.info.gain) : 'A'}
                onChange={(e) => uvSend(e.target.value === 'A' ? 'A' : `G${e.target.value}`)}
              >
                <option value="A">{t('Uv_Auto')}</option>
                {UV_GAINS.map((g) => (
                  <option key={g} value={g}>
                    {g}×
                  </option>
                ))}
              </select>
              <span title={t('Uv_ConvTip')}>{t('Uv_Conv')}</span>
              <select value={String(uv.info.conv ?? 64)} onChange={(e) => uvSend(`T${e.target.value}`)}>
                {UV_CONV.map((c) => (
                  <option key={c} value={c}>
                    {c} ms
                  </option>
                ))}
              </select>
            </div>
            {L.uva && ru && (
              <div style={{ fontSize: 11 }}>
                {t('Uv_Compare')
                  .replace('{s}', `${L.uva.percent.toFixed(L.uva.percent < 10 ? 2 : 1)} %${L.corrected ? '' : ' *'}`)
                  .replace('{a}', fmt(ru.uva))}
              </div>
            )}
          </div>
        )}

        {/* ---- AS7265x triad ---- */}
        {uv.triadInfo && (
          <div style={box}>
            <div style={{ fontWeight: 600 }}>{t('Tri_Title')}</div>
            {rt && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {t('Uv_Gain')} {rt.gain}× · {t('Tri_Int')} {rt.intMs.toFixed(0)} ms · {rt.tempC != null ? `${rt.tempC.toFixed(1)} °C` : ''} ·{' '}
                {t('Uv_Samples').replace('{n}', String(triRows.length))}
                {rt.flag === 'S' && <span style={{ color: 'rgb(190,0,0)', fontWeight: 600 }}> · {t('Uv_Saturated')}</span>}
                {rt.flag === 'L' && <span> · {t('Uv_Low')}</span>}
                {!!uv.triadInfo.fixed && <span title={t('Tri_FixedTip')}> · {t('Tri_Fixed').replace('{n}', String(uv.triadInfo.fixed))}</span>}
              </div>
            )}
            <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span>{t('Uv_Gain')}</span>
              <select
                value={uv.triadInfo.auto === false && uv.triadInfo.gain != null ? String(uv.triadInfo.gain) : 'A'}
                onChange={(e) => uvSend(e.target.value === 'A' ? 'SA' : `SG${TRI_GAIN_CMD[e.target.value]}`)}
              >
                <option value="A">{t('Uv_Auto')}</option>
                {TRI_GAINS.map((g) => (
                  <option key={g} value={g}>
                    {g}×
                  </option>
                ))}
              </select>
              <span>{t('Tri_Int')}</span>
              <select value={String(uv.triadInfo.cycles ?? 50)} onChange={(e) => uvSend(`SN${e.target.value}`)}>
                {TRI_CYCLES.map((c) => (
                  <option key={c} value={c}>
                    {(c * 2.8).toFixed(0)} ms
                  </option>
                ))}
              </select>
              <span title={t('Tri_LedTip')}>{t('Tri_Led')}</span>
              {(['W', 'I', 'U'] as const).map((k, i) => {
                const on = !!uv.triadInfo?.led[i]
                return (
                  <ToggleButton key={k} active={on} onClick={() => uvSend(`SL${k}${on ? 0 : 1}`)} title={t(`Tri_Led${k}`)}>
                    {k === 'W' ? t('Tri_LedWs') : k === 'I' ? 'IR' : 'UV'}
                  </ToggleButton>
                )
              })}
            </div>
            <div className="field-row" style={{ gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border, #eee)', paddingTop: 4 }}>
              <span title={t('Tri_CorrTip')}>{t('Tri_Corr')}</span>
              <input
                type="number"
                min={1500}
                max={4000}
                step={10}
                style={{ width: 70 }}
                placeholder={String(camT ?? 2700)}
                value={corrT}
                onChange={(e) => setCorrT(e.target.value)}
                title={t('Tri_CorrTTip')}
              />
              <span>K</span>
              <ToggleButton disabled={!triAvg} onClick={calibrateTriad} title={t('Tri_CorrTip')}>
                {t('Tri_CorrBtn')}
              </ToggleButton>
              {corr && (
                <ToggleButton
                  onClick={() => {
                    setSettings({ TriadCorr: '' })
                    triadClear()
                    setMsg(null)
                  }}
                >
                  {t('Tri_CorrOff')}
                </ToggleButton>
              )}
              <span style={{ fontSize: 11, color: corr ? 'rgb(0,110,0)' : 'var(--text-muted)' }}>
                {corr ? t('Tri_CorrOn').replace('{t}', String(corr.T)).replace('{d}', new Date(corr.date).toLocaleDateString()) : t('Tri_CorrNone')}
              </span>
            </div>
            {corr && showTable && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {t('Tri_CorrFactors')}{' '}
                {corr.f.map((f, i) => `${TRIAD_LETTERS[i]} ×${f.toFixed(2)}${corr.bad.includes(i) ? '!' : ''}`).join(' · ')}
              </div>
            )}
          </div>
        )}

        {showTable && bars.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px 10px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {bars.map((b) => {
              const f = formatIrradiance(b.v)
              return (
                <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: b.uv ? b.color : wavelengthToCss(Math.min(b.c, 780)), fontWeight: 600 }}>{b.uv ? b.label : `${b.sub} ${b.c} nm`}</span>
                  <span>
                    {f.value} {f.unit}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <ToggleButton disabled={!(hasTri || hasUv)} onClick={showInGraph} title={t('Sen_ShowTip')}>
            {t('Tri_Show')}
          </ToggleButton>
          {hasUv && hasTri && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={t('Sen_WithUvTip')}>
              <input type="checkbox" checked={withUv} onChange={(e) => setWithUv(e.target.checked)} /> {t('Sen_WithUv')}
            </label>
          )}
          <div style={{ flex: 1 }} />
          <ToggleButton onClick={clearAll} title={t('Uv_ClearTip')}>
            {t('Uv_Clear')}
          </ToggleButton>
          <ToggleButton onClick={saveCsv}>{t('Uv_SaveCsv')}</ToggleButton>
        </div>
        {hasTri && (
          <div className="field-row">
            <ToggleButton disabled={!triAvg} onClick={calibrate} title={t('Tri_CalTip')}>
              {t('Tri_Cal')}
            </ToggleButton>
          </div>
        )}
        {msg && <div style={{ fontSize: 11 }}>{msg}</div>}
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Sen_Hint').replace('{n}', String(AVG_N))}</div>
        {uv.info && <div style={{ fontSize: 11, color: 'rgb(160,90,0)' }}>{t('Uv_Safety')}</div>}
      </div>
    </FloatingWindow>
  )
}
