// Time log window (web-only): record spectrum quantities every N seconds, chart, CSV export
import { useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { MiniChart } from '../components/MiniChart'
import { useT } from '../i18n'
import { clearLog, logToCsv, setLogConfig, startLog, stopLog, useLog, type LogRow } from '../app/logStore'
import { downloadText } from '../core/files'
import { useWindowPos } from './useWindowPos'

type Quantity = 'total' | 'band' | 'at' | 'peakNm' | 'cct' | 'lux'
const INTERVALS = [1, 2, 5, 10, 30, 60, 300]

function Num({ value, onChange, width = 50 }: { value: number; onChange: (v: number) => void; width?: number }) {
  const [txt, setTxt] = useState(String(value))
  return (
    <input
      className="text-box"
      style={{ width }}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const v = Number.parseFloat(txt.replace(',', '.'))
        if (Number.isFinite(v)) onChange(v)
        else setTxt(String(value))
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function LogWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { running, rows, cfg } = useLog()
  const [pos, onMove] = useWindowPos('log', { x: 360, y: 140 })
  const [q, setQ] = useState<Quantity>('total')
  const t0 = rows[0]?.t ?? 0
  const val = (r: LogRow): number => {
    const v = r[q]
    return v == null ? NaN : v
  }
  const points: [number, number][] = rows.map((r) => [(r.t - t0) / 1000, val(r)])
  const last = rows[rows.length - 1]
  const first = rows[0]
  const change = first && last && Number.isFinite(val(first)) && val(first) !== 0 ? ((val(last) - val(first)) / val(first)) * 100 : null
  const elapsed = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 120 ? `${(s / 60).toFixed(0)} min` : `${s.toFixed(0)} s`)
  const fmt = (v: number) => (q === 'peakNm' ? v.toFixed(1) : q === 'cct' ? v.toFixed(0) : Math.abs(v) >= 1000 ? v.toExponential(2) : v.toPrecision(3))

  return (
    <FloatingWindow title={t('Lg_Title')} x={pos.x} y={pos.y} width={520} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <ToggleButton active={running} onClick={running ? stopLog : startLog}>
            {running ? t('Lg_Stop') : t('Lg_Start')}
          </ToggleButton>
          <ToggleButton onClick={clearLog}>{t('Lg_Clear')}</ToggleButton>
          <span>{t('Lg_Every')}</span>
          <select value={cfg.intervalS} onChange={(e) => setLogConfig({ intervalS: Number(e.target.value) })}>
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s >= 60 ? `${s / 60} min` : `${s} s`}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <ToggleButton onClick={() => rows.length && downloadText('time_log.csv', logToCsv(rows, cfg))}>{t('Lg_Export')}</ToggleButton>
        </div>
        <div className="field-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span>{t('Lg_Show')}</span>
          <select value={q} onChange={(e) => setQ(e.target.value as Quantity)}>
            <option value="total">{t('Lg_Q_total')}</option>
            <option value="band">{t('Lg_Q_band')}</option>
            <option value="at">{t('Lg_Q_at')}</option>
            <option value="peakNm">{t('Lg_Q_peakNm')}</option>
            <option value="cct">{t('Lg_Q_cct')}</option>
            <option value="lux">{t('Lg_Q_lux')}</option>
          </select>
          {q === 'band' && (
            <>
              <Num value={cfg.bandLo} onChange={(v) => setLogConfig({ bandLo: v })} />–
              <Num value={cfg.bandHi} onChange={(v) => setLogConfig({ bandHi: v })} /> nm
            </>
          )}
          {q === 'at' && (
            <>
              <Num value={cfg.atNm} onChange={(v) => setLogConfig({ atNm: v })} /> ±
              <Num value={cfg.atWidth} onChange={(v) => setLogConfig({ atWidth: Math.max(0.3, v) })} width={36} /> nm
            </>
          )}
        </div>
        <MiniChart series={[{ points, color: 'rgb(0,80,200)' }]} width={500} height={200} xFormat={elapsed} yFormat={fmt} />
        <div style={{ fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {t('Lg_Samples')}: {rows.length}
          </span>
          {last && (
            <span>
              {t('Lg_Last')}: <b>{Number.isFinite(val(last)) ? fmt(val(last)) : '—'}</b>
            </span>
          )}
          {change != null && (
            <span>
              {t('Lg_Change')}: <b>{`${change >= 0 ? '+' : ''}${change.toFixed(1)} %`}</b>
            </span>
          )}
          {last && first && <span>{elapsed((last.t - first.t) / 1000)}</span>}
        </div>
        {(q === 'cct' || q === 'lux') && <div style={{ fontSize: 10, color: 'rgb(140,80,0)' }}>{t('Lg_LightNote')}</div>}
        <div style={{ fontSize: 10, color: 'rgb(120,120,120)' }}>{t('Lg_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
