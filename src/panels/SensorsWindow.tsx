// Sensor board window (web-only): AS7331 UV (UVA/UVB/UVC) + AS7265x spectral triad (18 channels 410–940 nm)
// over one shared Web Serial link, one combined bar chart 240–960 nm.
import { useMemo, useState, type CSSProperties } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { downloadText } from '../core/files'
import { wavelengthToCss } from '../core/wavelengthColor'
import { loadDataIntoPipeline } from '../app/engine'
import { setRuntime } from '../app/store'
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
import type { TriadReading, UvReading } from '../serial/uvSensor'
import { useWindowPos } from './useWindowPos'

// AS7331 channels: approximate sensitivity bands (datasheet peaks 360 / 300 / 260 nm)
const UV_CH = [
  { key: 'uva', label: 'UVA', lo: 320, hi: 400, c: 360, color: '#7e4cc2' },
  { key: 'uvb', label: 'UVB', lo: 280, hi: 320, c: 300, color: '#5a2d8a' },
  { key: 'uvc', label: 'UVC', lo: 240, hi: 280, c: 260, color: '#3b1f5c' },
] as const
const TRIAD_FWHM = 20 // nm, AS7265x channel width

const UV_GAINS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
const UV_CONV = [1, 2, 4, 8, 16, 32, 64]
const PERIODS = [100, 250, 500, 1000, 2000, 5000, 10000, 60000]
const TRI_GAINS = ['1', '3.7', '16', '64']
const TRI_GAIN_CMD: Record<string, string> = { '1': '1', '3.7': '4', '16': '16', '64': '64' }
const TRI_CYCLES = [10, 18, 36, 50, 100, 180, 255] // × 2.8 ms
const AVG_N = 10

const uvVal = (r: UvReading, c: number) => (c === 0 ? r.uva : c === 1 ? r.uvb : r.uvc)

/** One bar of the combined chart: wavelength band, value in µW/cm² (band total) */
interface Bar {
  lo: number
  hi: number
  c: number
  v: number
  color: string
  label: string
}

function uvBars(r: UvReading | null): Bar[] {
  if (!r) return []
  return UV_CH.map((ch, i) => ({ lo: ch.lo, hi: ch.hi, c: ch.c, v: uvVal(r, i), color: ch.color, label: ch.label }))
}

function triadBars(r: TriadReading | null): Bar[] {
  if (!r) return []
  return r.values.map((v, i) => ({
    lo: r.nm[i] - TRIAD_FWHM / 2,
    hi: r.nm[i] + TRIAD_FWHM / 2,
    c: r.nm[i],
    v,
    color: wavelengthToCss(Math.min(r.nm[i], 780)),
    label: `${r.nm[i]} nm`,
  }))
}

/** Bar height: band total, or spectral density (total / band width) so wide and narrow channels compare */
const barValue = (b: Bar, density: boolean) => (density ? b.v / (b.hi - b.lo) : b.v)

function Chart({ bars, log, density }: { bars: Bar[]; log: boolean; density: boolean }) {
  const W = 480
  const H = 180
  const L = 38
  const B = 22
  const nmLo = bars.some((b) => b.c < 400) ? 230 : 390
  const nmHi = 960
  const x = (nm: number) => L + ((nm - nmLo) / (nmHi - nmLo)) * (W - L - 6)
  const vals = bars.map((b) => barValue(b, density))
  const vmax = Math.max(...vals, 1e-6)
  const vminLog = Math.max(vmax / 1e4, 1e-4)
  const y = (v: number) => {
    const f = log ? (Math.log10(Math.max(v, vminLog)) - Math.log10(vminLog)) / (Math.log10(vmax) - Math.log10(vminLog) || 1) : v / vmax
    return H - B - Math.max(0, Math.min(1, f)) * (H - B - 8)
  }
  const unit = formatIrradiance(vmax)
  const ticks = [300, 400, 500, 600, 700, 800, 900].filter((nm) => nm > nmLo)
  return (
    <svg width={W} height={H} aria-label="sensor channels" style={{ background: '#fff', border: '1px solid var(--border, #ddd)', borderRadius: 6 }}>
      {ticks.map((nm) => (
        <g key={nm}>
          <line x1={x(nm)} x2={x(nm)} y1={8} y2={H - B} stroke="#e8e8e8" />
          <text x={x(nm)} y={H - 7} fontSize={10} textAnchor="middle" fill="#666">
            {nm}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - 6} y1={H - B} y2={H - B} stroke="#999" />
      <text x={4} y={14} fontSize={10} fill="#666">
        {unit.value}
      </text>
      <text x={4} y={26} fontSize={9} fill="#999">
        {unit.unit}
        {density ? '/nm' : ''}
      </text>
      {bars.map((b, i) => {
        const v = vals[i]
        const top = y(v)
        const uv = b.c < 400
        // UV bands drawn over their full (wide) band, triad channels as 10 nm bars
        const x0 = uv ? x(b.lo) + 1 : x(b.c - 5)
        const x1 = uv ? x(b.hi) - 1 : x(b.c + 5)
        const f = formatIrradiance(b.v)
        return (
          <g key={b.label}>
            <rect x={x0} y={top} width={Math.max(1, x1 - x0)} height={H - B - top} fill={b.color} opacity={uv ? 0.8 : b.c > 700 ? 0.75 : 1}>
              <title>{`${b.label}: ${f.value} ${f.unit}`}</title>
            </rect>
            {uv && (
              <text x={(x0 + x1) / 2} y={Math.max(18, top - 3)} fontSize={9} textAnchor="middle" fill={b.color}>
                {b.label}
              </text>
            )}
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
  const [log, setLog] = useState(false)
  const [density, setDensity] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [withUv, setWithUv] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator

  const ru = uv.last
  const rt = uv.triadLast
  const uvRows = useMemo(() => uv.rows.filter((x) => x.t >= uv.resetAt), [uv.rows, uv.resetAt])
  const triRows = useMemo(() => uv.triadRows.filter((x) => x.t >= uv.triadResetAt), [uv.triadRows, uv.triadResetAt])
  const st = uvStats(uvRows)
  const uvStale = ru ? Date.now() - ru.t > 5000 : false
  const hasUv = !!uv.info && !!ru
  const hasTri = !!uv.triadInfo && !!rt
  const bars = [...(hasUv ? uvBars(ru) : []), ...(hasTri ? triadBars(rt) : [])]
  const triAvg = triadAverage(triRows, AVG_N)
  const uvAvg = meanUv(uvRows, AVG_N)
  const L = currentLight()

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
    if (withUv && hasUv && uvAvg) uvBars(uvAvg).forEach((b) => pts.push({ nm: b.c, v: barValue(b, true) }))
    if (hasTri && triAvg) triadBars(triAvg).forEach((b) => pts.push({ nm: b.c, v: barValue(b, true) }))
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
    <FloatingWindow title={t('Sen_Title')} x={pos.x} y={pos.y} width={500} onMove={onMove} onClose={onClose} className="compare-window">
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
        </div>

        {/* ---- AS7331 UV ---- */}
        {uv.info && (
          <div style={{ ...box, opacity: uvStale ? 0.5 : 1 }}>
            <div style={{ fontWeight: 600 }}>{t('Uv_Title')}</div>
            {UV_CH.map((ch, c) => {
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
          </div>
        )}

        {showTable && bars.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px 10px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {bars.map((b) => {
              const f = formatIrradiance(b.v)
              return (
                <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: b.c < 400 ? b.color : wavelengthToCss(Math.min(b.c, 780)), fontWeight: 600 }}>{b.label}</span>
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
