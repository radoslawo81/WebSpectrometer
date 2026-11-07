// Absorbance window (web-only): A(λ) = −log10(T) of a liquid in a cuvette, λmax, A at a chosen
// wavelength, concentration from Beer–Lambert (ε, l) or from a calibration line of standards.
import { useEffect, useMemo, useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { MiniChart } from '../components/MiniChart'
import { useT } from '../i18n'
import { pipeline } from '../app/engine'
import { computeTransmission, tAt, type Snapshot, type TransCurve } from '../core/transmission'
import { downloadText } from '../core/files'
import { useWindowPos } from './useWindowPos'

const STD_KEY = 'webspectrometer.absStandards'
const CFG_KEY = 'webspectrometer.absConfig'

interface Standard {
  c: number
  a: number
}

function snap(): Snapshot {
  return { nmMin: pipeline.nmMin, nmMax: pipeline.nmMax, values: Array.from(pipeline.uncorrected) }
}

function absAt(c: TransCurve, nm: number, width: number): number {
  let s = 0
  let k = 0
  for (let x = nm - width; x <= nm + width + 1e-9; x += 0.5) {
    const tv = tAt(c, x)
    if (Number.isFinite(tv)) {
      s += tv
      k++
    }
  }
  if (!k) return NaN
  const tm = s / k
  return tm > 0 ? -Math.log10(tm) : Infinity
}

// Least squares line a = m·c + b (or through origin)
function fitLine(stds: Standard[], origin: boolean): { m: number; b: number; r2: number } | null {
  if (stds.length < (origin ? 1 : 2)) return null
  const n = stds.length
  const sx = stds.reduce((s, p) => s + p.c, 0)
  const sy = stds.reduce((s, p) => s + p.a, 0)
  const sxx = stds.reduce((s, p) => s + p.c * p.c, 0)
  const sxy = stds.reduce((s, p) => s + p.c * p.a, 0)
  let m: number
  let b: number
  if (origin) {
    m = sxy / sxx
    b = 0
  } else {
    m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    b = (sy - m * sx) / n
  }
  const mean = sy / n
  const ssTot = stds.reduce((s, p) => s + (p.a - mean) ** 2, 0)
  const ssRes = stds.reduce((s, p) => s + (p.a - (m * p.c + b)) ** 2, 0)
  return { m, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 }
}

export function AbsorbanceWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('abs', { x: 340, y: 110 })
  const [dark, setDark] = useState<Snapshot | null>(null)
  const [blank, setBlank] = useState<Snapshot | null>(null)
  const [curve, setCurve] = useState<TransCurve | null>(null)
  const [cfg, setCfg] = useState(() => {
    try {
      const s = localStorage.getItem(CFG_KEY)
      if (s) return JSON.parse(s) as { nm: number; width: number; mode: 'beer' | 'curve'; eps: number; path: number; origin: boolean; unit: string }
    } catch {
      // ignore
    }
    return { nm: 430, width: 2, mode: 'curve' as 'beer' | 'curve', eps: 1000, path: 1, origin: true, unit: 'mg/L' }
  })
  const [stds, setStds] = useState<Standard[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STD_KEY) || '[]') as Standard[]
    } catch {
      return []
    }
  })
  const [stdC, setStdC] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
    } catch {
      // ignore
    }
  }, [cfg])
  useEffect(() => {
    try {
      localStorage.setItem(STD_KEY, JSON.stringify(stds))
    } catch {
      // ignore
    }
  }, [stds])

  // Live absorbance against the blank
  useEffect(() => {
    if (!blank) return
    const tick = () => {
      const c = computeTransmission(snap(), blank, dark)
      setCurve(typeof c === 'string' ? null : c)
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [blank, dark])

  const absPts = useMemo<[number, number][]>(() => {
    if (!curve) return []
    return curve.t.map((tv, i) => [curve.nmStart + i, Number.isFinite(tv) && tv > 0 ? Math.min(4, -Math.log10(tv)) : NaN])
  }, [curve])

  const lambdaMax = useMemo(() => {
    let best: [number, number] | null = null
    for (const p of absPts) if (Number.isFinite(p[1]) && p[1] < 3.9 && (!best || p[1] > best[1])) best = p
    return best
  }, [absPts])

  const A = curve ? absAt(curve, cfg.nm, cfg.width) : NaN
  const line = fitLine(stds, cfg.origin)
  const conc =
    !Number.isFinite(A) ? NaN : cfg.mode === 'beer' ? A / (cfg.eps * cfg.path) : line && line.m !== 0 ? (A - line.b) / line.m : NaN
  const outOfRange = Number.isFinite(A) && (A > 2 || A < 0.02)

  const addStd = () => {
    const c = Number.parseFloat(stdC.replace(',', '.'))
    if (!Number.isFinite(c) || !Number.isFinite(A)) return
    setStds([...stds, { c, a: A }].sort((p, q) => p.c - q.c))
    setStdC('')
  }

  const exportCsv = () => {
    if (!absPts.length) return
    downloadText('absorbance.csv', 'nm;A\n' + absPts.filter((p) => Number.isFinite(p[1])).map((p) => `${p[0]};${p[1].toFixed(4)}`).join('\n') + '\n')
  }

  const num = (v: number, onSet: (x: number) => void, w = 56) => (
    <input
      className="text-box"
      style={{ width: w }}
      defaultValue={String(v)}
      onBlur={(e) => {
        const x = Number.parseFloat(e.target.value.replace(',', '.'))
        if (Number.isFinite(x) && x > 0) onSet(x)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )

  return (
    <FloatingWindow title={t('Ab_Title')} x={pos.x} y={pos.y} width={480} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <ToggleButton active={!!dark} onClick={() => setDark(snap())} title={t('Ab_DarkTip')}>
            1. {t('Tr_Dark')}
          </ToggleButton>
          <ToggleButton active={!!blank} onClick={() => setBlank(snap())} title={t('Ab_BlankTip')}>
            2. {t('Ab_Blank')}
          </ToggleButton>
          <span style={{ fontSize: 11 }}>3. {t('Ab_Sample')}</span>
          <div style={{ flex: 1 }} />
          <ToggleButton onClick={exportCsv}>{t('Tr_Export')}</ToggleButton>
        </div>
        {!blank && <div style={{ fontSize: 11, color: 'rgb(160,90,0)' }}>{t('Ab_NeedBlank')}</div>}
        <MiniChart
          series={[{ points: absPts, color: 'rgb(120,0,160)' }]}
          width={460}
          height={180}
          yMin={0}
          yLabel="A"
          yFormat={(y) => y.toFixed(2)}
          markers={[
            { x: cfg.nm, color: 'rgb(0,120,0)', label: `${cfg.nm} nm` },
            ...(lambdaMax ? [{ x: lambdaMax[0], color: 'rgb(200,0,0)', label: 'λmax' }] : []),
          ]}
        />
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>{t('Ab_At')}</span>
          {num(cfg.nm, (x) => setCfg({ ...cfg, nm: x }))} nm ±{num(cfg.width, (x) => setCfg({ ...cfg, width: x }), 36)} nm
          {lambdaMax && (
            <a href="#" onClick={(e) => (e.preventDefault(), setCfg({ ...cfg, nm: Math.round(lambdaMax[0]) }))} style={{ fontSize: 11 }}>
              {t('Ab_UseMax').replace('{nm}', lambdaMax[0].toFixed(0))}
            </a>
          )}
        </div>
        <div style={{ fontSize: 14 }}>
          A = <b>{Number.isFinite(A) ? A.toFixed(3) : '—'}</b>
          <span style={{ fontSize: 11, color: '#666', marginLeft: 10 }}>T = {Number.isFinite(A) ? `${(Math.pow(10, -A) * 100).toFixed(1)} %` : '—'}</span>
        </div>
        {outOfRange && <div style={{ fontSize: 11, color: 'rgb(160,90,0)' }}>{t('Ab_Range')}</div>}

        <fieldset style={{ border: '1px solid rgb(200,190,160)', padding: '4px 6px' }}>
          <legend style={{ fontSize: 11 }}>{t('Ab_Conc')}</legend>
          <div className="field-row" style={{ gap: 10 }}>
            <label>
              <input type="radio" checked={cfg.mode === 'curve'} onChange={() => setCfg({ ...cfg, mode: 'curve' })} /> {t('Ab_ModeCurve')}
            </label>
            <label>
              <input type="radio" checked={cfg.mode === 'beer'} onChange={() => setCfg({ ...cfg, mode: 'beer' })} /> {t('Ab_ModeBeer')}
            </label>
          </div>
          {cfg.mode === 'beer' ? (
            <div className="field-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              ε {num(cfg.eps, (x) => setCfg({ ...cfg, eps: x }), 70)} L·mol⁻¹·cm⁻¹ &nbsp; l {num(cfg.path, (x) => setCfg({ ...cfg, path: x }), 40)} cm
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span>{t('Ab_StdConc')}</span>
                <input className="text-box" style={{ width: 60 }} value={stdC} onChange={(e) => setStdC(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStd()} />
                <input className="text-box" style={{ width: 50 }} value={cfg.unit} onChange={(e) => setCfg({ ...cfg, unit: e.target.value })} />
                <ToggleButton onClick={addStd} title={t('Ab_AddStdTip')}>
                  {t('Ab_AddStd')}
                </ToggleButton>
                <label style={{ fontSize: 11 }}>
                  <input type="checkbox" checked={cfg.origin} onChange={(e) => setCfg({ ...cfg, origin: e.target.checked })} /> {t('Ab_Origin')}
                </label>
              </div>
              {stds.length > 0 && (
                <table style={{ fontSize: 11, marginTop: 4, borderCollapse: 'collapse' }}>
                  <tbody>
                    {stds.map((p, i) => (
                      <tr key={i}>
                        <td style={{ paddingRight: 10 }}>
                          {p.c} {cfg.unit}
                        </td>
                        <td style={{ paddingRight: 10 }}>A = {p.a.toFixed(3)}</td>
                        <td>
                          <a href="#" onClick={(e) => (e.preventDefault(), setStds(stds.filter((_, k) => k !== i)))}>
                            ✕
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {line && (
                <div style={{ fontSize: 11, color: '#555' }}>
                  A = {line.m.toPrecision(4)}·c {line.b >= 0 ? '+' : '−'} {Math.abs(line.b).toPrecision(3)} &nbsp; R² = {line.r2.toFixed(4)}
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 14, marginTop: 4 }}>
            c = <b>{Number.isFinite(conc) ? conc.toPrecision(4) : '—'}</b> {cfg.mode === 'beer' ? 'mol/L' : cfg.unit}
          </div>
        </fieldset>
        <div style={{ fontSize: 10, color: 'rgb(120,120,120)' }}>{t('Ab_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
