// Transmission floating window (web-only): glasses / filters / windows.
// 1) Dark  2) 100 % (lamp, no sample)  3) sample in the beam → live T(λ), save & compare curves,
// luminous transmittance + sunglass category, band means (UV-B … IR), colour of daylight through the
// lens with colour rendering, colour swatches without / with the lens, CSV export.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { clearDark, liveCurve, liveWeight, removeSaved, saveBlank, saveDark, saveSample, updateSaved, useTrans } from '../app/transStore'
import { FULL_SCALE } from '../app/lightStore'
import { bandMeans, curveToCsv, daylightThrough, luminousTransmittance, swatches, tAt, type TransCurve } from '../core/transmission'
import { downloadText } from '../core/files'

const POS_KEY = 'webspectrometer.transWindowPos'
const CHART_W = 500
const CHART_H = 190
const PAD = { l: 34, r: 8, t: 8, b: 20 }

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)} %`)
const BAND_RANGE: Record<string, string> = {
  UVB: '280–315',
  UVA: '315–380',
  HEV: '400–455',
  B: '400–500',
  G: '500–600',
  R: '600–700',
  IR: '780–1000',
}

function Chart({ curves, od }: { curves: { curve: TransCurve; color: string; width: number }[]; od: boolean }) {
  const all = curves.filter((c) => c.curve.t.length > 1)
  if (all.length === 0) return <div style={{ height: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>—</div>
  const lo = Math.min(...all.map((c) => c.curve.nmStart))
  const hi = Math.max(...all.map((c) => c.curve.nmStart + c.curve.t.length - 1))
  const yMax = od ? 4 : 1
  const x = (nm: number) => PAD.l + ((nm - lo) / Math.max(1, hi - lo)) * (CHART_W - PAD.l - PAD.r)
  const y = (t: number) => {
    const v = od ? (t > 0 ? Math.min(yMax, -Math.log10(t)) : yMax) : Math.min(1.1, Math.max(0, t))
    return od ? PAD.t + (v / yMax) * (CHART_H - PAD.t - PAD.b) : CHART_H - PAD.b - (v / yMax) * (CHART_H - PAD.t - PAD.b)
  }
  const grid: number[] = []
  for (let nm = Math.ceil(lo / 100) * 100; nm <= hi; nm += 100) grid.push(nm)
  const yTicks = od ? [0, 1, 2, 3, 4] : [0, 0.2, 0.4, 0.6, 0.8, 1]
  const band = (a: number, b: number, fill: string) => {
    const xa = x(Math.max(lo, a))
    const xb = x(Math.min(hi, b))
    return xb > xa ? <rect x={xa} y={PAD.t} width={xb - xa} height={CHART_H - PAD.t - PAD.b} fill={fill} /> : null
  }
  const path = (c: TransCurve) => {
    let d = ''
    let pen = false
    c.t.forEach((t, i) => {
      if (!Number.isFinite(t)) {
        pen = false
        return
      }
      const nm = c.nmStart + i
      d += `${pen ? 'L' : 'M'}${x(nm).toFixed(1)},${y(t).toFixed(1)}`
      pen = true
    })
    return d
  }
  return (
    <svg width={CHART_W} height={CHART_H} style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 4 }}>
      {band(-1e9, 380, 'rgba(150,80,220,0.12)')}
      {band(780, 1e9, 'rgba(120,120,120,0.12)')}
      {grid.map((nm) => (
        <g key={nm}>
          <line x1={x(nm)} x2={x(nm)} y1={PAD.t} y2={CHART_H - PAD.b} stroke="rgb(200,200,200)" />
          <text x={x(nm)} y={CHART_H - 6} fontSize={10} textAnchor="middle">
            {nm}
          </text>
        </g>
      ))}
      {yTicks.map((v) => {
        const yy = od ? PAD.t + (v / yMax) * (CHART_H - PAD.t - PAD.b) : CHART_H - PAD.b - (v / yMax) * (CHART_H - PAD.t - PAD.b)
        return (
          <g key={v}>
            <line x1={PAD.l} x2={CHART_W - PAD.r} y1={yy} y2={yy} stroke="rgb(215,215,215)" />
            <text x={PAD.l - 3} y={yy + 3} fontSize={10} textAnchor="end">
              {od ? v : `${v * 100}`}
            </text>
          </g>
        )
      })}
      <text x={4} y={PAD.t + 8} fontSize={10}>
        {od ? 'OD' : '%'}
      </text>
      {all.map((c, i) => (
        <path key={i} d={path(c.curve)} fill="none" stroke={c.color} strokeWidth={c.width} />
      ))}
    </svg>
  )
}

export function TransmissionWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { dark, blank, saved } = useTrans()
  const [pos, setPos] = useState({ x: 300, y: 90 })
  const [live, setLive] = useState<TransCurve | string | null>(() => liveCurve())
  const [label, setLabel] = useState('')
  const [od, setOd] = useState(false)
  const [focus, setFocus] = useState<'live' | number>('live')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    try {
      const s = localStorage.getItem(POS_KEY)
      if (s) setPos(JSON.parse(s))
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

  useEffect(() => {
    const id = setInterval(() => setLive(liveCurve()), 500)
    return () => clearInterval(id)
  }, [])
  useEffect(() => setLive(liveCurve()), [dark, blank])

  const liveOk = live && typeof live !== 'string' ? live : null
  const focused: TransCurve | null = focus === 'live' ? liveOk : saved.find((s) => s.id === focus)?.curve ?? null
  const focusedWeight: TransCurve | null = focus === 'live' ? (blank ? liveWeight() : null) : saved.find((s) => s.id === focus)?.weight ?? null
  const blankSaturated = blank ? Math.max(...blank.values) >= 0.97 * FULL_SCALE : false

  const results = useMemo(() => {
    if (!focused) return null
    return {
      bands: bandMeans(focused, focusedWeight ? (nm) => tAt(focusedWeight, nm) : undefined),
      lum: luminousTransmittance(focused),
      day: daylightThrough(focused),
      sw: swatches(focused),
      range: (() => {
        const idx = focused.t.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0)
        return idx.length ? [focused.nmStart + idx[0], focused.nmStart + idx[idx.length - 1]] : null
      })(),
    }
  }, [focused, focusedWeight])

  const curves = [
    ...saved.filter((s) => s.visible).map((s) => ({ curve: s.curve, color: s.color, width: focus === s.id ? 2.2 : 1.3 })),
    ...(liveOk ? [{ curve: liveOk, color: '#000', width: focus === 'live' ? 2 : 1.2 }] : []),
  ]

  const doSave = () => {
    const err = saveSample(label.trim())
    if (err === 'no-blank') setMsg(t('Tr_NeedBlank'))
    else if (err) setMsg(t(err))
    else {
      setMsg(t('Tr_Saved'))
      setLabel('')
    }
  }
  const exportCsv = () => {
    const list = [...saved.map((s) => ({ label: s.label, curve: s.curve })), ...(liveOk ? [{ label: 'Live', curve: liveOk }] : [])]
    if (list.length) downloadText('transmission.csv', curveToCsv(list))
  }

  const catText = (c: number | null) => (c == null ? '—' : c === 5 ? t('Tr_CatBelow4') : `${c}`)
  const lens = results?.day.lens

  return (
    <FloatingWindow title={t('Tr_Title')} x={pos.x} y={pos.y} width={CHART_W + 18} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
        {/* Steps */}
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <ToggleButton active={!!dark} onClick={saveDark} title={t('Tr_DarkTip')}>
            1. {t('Tr_Dark')}
          </ToggleButton>
          {dark && (
            <a href="#" onClick={(e) => (e.preventDefault(), clearDark())} style={{ fontSize: 11 }}>
              ✕
            </a>
          )}
          <ToggleButton active={!!blank} onClick={saveBlank} title={t('Tr_BlankTip')}>
            2. {t('Tr_Blank')}
          </ToggleButton>
          <span>3.</span>
          <input className="text-box" style={{ width: 110 }} placeholder={t('Tr_LabelPh')} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSave()} />
          <ToggleButton onClick={doSave} title={t('Tr_SaveTip')}>
            {t('Tr_SaveSample')}
          </ToggleButton>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('Tr_Steps')}</div>

        <Chart curves={curves} od={od} />
        <div className="field-row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
          <label>
            <input type="checkbox" checked={od} onChange={(e) => setOd(e.target.checked)} /> {t('Tr_OD')}
          </label>
          <span>
            {t('Tr_ResultsFor')}{' '}
            <select value={String(focus)} onChange={(e) => setFocus(e.target.value === 'live' ? 'live' : Number(e.target.value))}>
              <option value="live">{t('Tr_Live')}</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        {/* Warnings */}
        <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!blank && <span style={{ color: 'rgb(160,90,0)' }}>{t('Tr_NeedBlank')}</span>}
          {blankSaturated && <span style={{ color: 'rgb(190,0,0)' }}>{t('Tr_WarnSat')}</span>}
          {typeof live === 'string' && <span style={{ color: 'rgb(190,0,0)' }}>{t(live)}</span>}
          {results?.range && (results.range[0] > 380 || results.range[1] < 780) && (
            <span style={{ color: 'rgb(160,90,0)' }}>{t('Tr_WarnRange').replace('{range}', `${results.range[0]}–${results.range[1]}`)}</span>
          )}
        </div>

        {results && (
          <>
            {/* Luminous transmittance & bands */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ fontWeight: 'bold' }} title={t('Tr_TauVTip')}>
                  <td>{t('Tr_TauV')}</td>
                  <td style={{ textAlign: 'right' }}>{pct(results.lum.tauV)}</td>
                  <td style={{ textAlign: 'right' }} title={t('Tr_VisBlockedTip')}>
                    {results.lum.tauV != null ? `−${pct(1 - results.lum.tauV)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {t('Tr_Category')} {catText(results.lum.category)}
                  </td>
                </tr>
                <tr style={{ fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid rgb(200,200,200)' }}>
                  <td>{t('Tr_Band')}</td>
                  <td style={{ textAlign: 'right' }} title={t('Tr_MeanTip')}>
                    {t('Tr_Mean')}
                  </td>
                  <td style={{ textAlign: 'right' }} title={t('Tr_EnergyTip')}>
                    {t('Tr_Energy')}
                  </td>
                  <td />
                </tr>
                {results.bands.map((b) => (
                  <tr key={b.key}>
                    <td>{t(`Tr_Band_${b.key}`)} {BAND_RANGE[b.key]} nm</td>
                    <td style={{ textAlign: 'right' }}>{pct(b.mean)}</td>
                    <td style={{ textAlign: 'right' }}>{b.energyBlocked != null ? `−${pct(b.energyBlocked)}` : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
                      {b.coverage < 0.97 ? (b.coverage > 0 ? t('Tr_Partial').replace('{p}', Math.floor(b.coverage * 100).toString()) : t('Tr_NotMeasured')) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Colour of daylight through the lens */}
            <fieldset style={{ border: '1px solid var(--border)', padding: '4px 6px' }}>
              <legend style={{ fontSize: 11 }}>{t('Tr_ColourTitle')}</legend>
              {lens ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div title={t('Tr_WhiteTip')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 10 }}>
                    <div style={{ display: 'flex' }}>
                      <div style={{ width: 28, height: 28, background: results.sw[0].without, border: '1px solid #999' }} />
                      <div style={{ width: 28, height: 28, background: results.sw[0].through, border: '1px solid #999' }} />
                    </div>
                    {t('Tr_White')}
                  </div>
                  <table style={{ flex: 1, borderCollapse: 'collapse', fontSize: 12 }}>
                    <tbody>
                      <tr>
                        <td>{t('Tr_CCT')}</td>
                        <td style={{ textAlign: 'right' }}>{lens.cct ? `${lens.cct.toFixed(0)} K` : '—'} <span style={{ color: '#888' }}>(D65: 6504 K)</span></td>
                      </tr>
                      <tr title={t('Lq_DuvTip')}>
                        <td>Duv</td>
                        <td style={{ textAlign: 'right' }}>{lens.duv != null ? lens.duv.toFixed(4) : '—'}</td>
                      </tr>
                      <tr title={t('Tr_RaTip')}>
                        <td>Ra / R9</td>
                        <td style={{ textAlign: 'right' }}>
                          {lens.cri ? `${lens.cri.Ra.toFixed(1)} / ${lens.cri.Ri[8].toFixed(1)}${lens.duv != null && Math.abs(lens.duv) >= 0.0054 ? ' *' : ''}` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                '—'
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 2, marginTop: 6 }} title={t('Tr_SwatchTip')}>
                {results.sw.slice(1).map((s) => (
                  <div key={s.name} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ height: 16, background: s.without }} />
                    <div style={{ height: 16, background: s.through }} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#777', marginTop: 2 }}>{t('Tr_SwatchTip')}</div>
            </fieldset>
          </>
        )}

        {/* Saved curves */}
        {saved.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {saved.map((s) => (
              <div key={s.id} className="field-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={s.visible} onChange={(e) => updateSaved(s.id, { visible: e.target.checked })} />
                <span style={{ width: 14, height: 3, background: s.color, display: 'inline-block' }} />
                <input className="text-box" style={{ flex: 1 }} value={s.label} onChange={(e) => updateSaved(s.id, { label: e.target.value })} />
                <span style={{ fontSize: 11, color: '#666' }}>{pct(luminousTransmittance(s.curve).tauV, 0)}</span>
                <a href="#" onClick={(e) => (e.preventDefault(), removeSaved(s.id), focus === s.id && setFocus('live'))}>
                  ✕
                </a>
              </div>
            ))}
          </div>
        )}

        <div className="field-row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>{msg}</span>
          <ToggleButton onClick={exportCsv}>{t('Tr_Export')}</ToggleButton>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('Tr_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
