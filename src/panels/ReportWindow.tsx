// Measurement report (web-only): one printable page with the spectrum image, metadata and the
// results of the Light / Compare / Transmission / Lines tools. Opens in a new tab (print → PDF)
// or downloads as a self-contained HTML file.
import { useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { getState } from '../app/store'
import { activeResponse, pipeline } from '../app/engine'
import { currentLight, getLux } from '../app/lightStore'
import { getCompareState } from '../app/compareStore'
import { getTransState } from '../app/transStore'
import { bandMeans, luminousTransmittance } from '../core/transmission'
import { identifyPeaks } from '../core/lineIdent'
import { parseSets } from './LinesWindow'
import { downloadText } from '../core/files'
import { useWindowPos } from './useWindowPos'
import { formatIrradiance, recentUv } from '../app/uvStore'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function ReportWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('report', { x: 360, y: 120 })
  const [title, setTitle] = useState(() => getState().settings.FileName || 'Spectrum')
  const [source, setSource] = useState('')
  const [notes, setNotes] = useState('')
  const [inc, setInc] = useState({ light: true, compare: true, trans: true, lines: true, cal: true })

  const build = (): string => {
    const st = getState()
    const s = st.settings
    const canvas = document.querySelector<HTMLCanvasElement>('.spectrum-canvas')
    const img = canvas ? canvas.toDataURL('image/png') : ''
    const rows: string[] = []
    const kv = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
    const date = new Date().toLocaleString()

    // Metadata
    const meta = [
      kv(t('Rp_Date'), date),
      kv(t('Rp_Source'), source || '—'),
      kv(t('Rp_Device'), st.runtime.fileMode ? `${t('Rp_File')}: ${st.runtime.fileMode}` : st.runtime.deviceLabel || s.SensorType),
      kv(t('Rp_Range'), `${pipeline.nmMin.toFixed(1)} – ${pipeline.nmMax.toFixed(1)} nm`),
      kv(t('Rp_Filters'), `Average ${s.AverageEnabled ? s.Average : '—'} · Spatial ${s.SpatialAveraging} · Rising ${s.RisingSpeed} · Falling ${s.FallingSpeed}`),
      kv(t('Rp_Response'), activeResponse() ? `${t('Rp_Yes')} (${activeResponse()!.validLo}–${activeResponse()!.validHi} nm)` : t('Rp_No')),
    ]
    if (inc.cal) meta.push(kv(t('Rp_CalPoints'), st.calibration.nms.map((n) => n.toFixed(2)).join(', ') + ' nm'))
    rows.push(`<h2>${esc(t('Rp_Meta'))}</h2><table>${meta.join('')}</table>`)

    if (inc.light) {
      const L = currentLight()
      const m = L.metrics
      if (m) {
        const lux = L.corrected ? getLux(m.photometricSum) : null
        const items = [
          kv(t('Lq_CCT'), m.cct ? `${m.cct.toFixed(0)} K` : '—'),
          kv('Duv', m.duv != null ? m.duv.toFixed(4) : '—'),
          kv('x, y', `${m.x.toFixed(4)}, ${m.y.toFixed(4)}`),
          kv('CRI Ra / R9', m.cri ? `${m.cri.Ra.toFixed(1)} / ${m.cri.Ri[8].toFixed(1)}${m.duv != null && Math.abs(m.duv) >= 0.0054 ? ' *' : ''}` : '—'),
          kv(t('Lq_LER'), `${m.ler.toFixed(0)} lm/W`),
          kv(t('Lq_Lux'), lux != null ? `${lux.toFixed(1)} lx` : '—'),
        ]
        const warn = L.corrected ? '' : `<p class="warn">${esc(t('Lq_WarnNoResponse'))}</p>`
        rows.push(`<h2>${esc(t('Lq_Title'))}</h2><table>${items.join('')}</table>${warn}`)
      }
    }

    if (inc.compare) {
      const c = getCompareState()
      if (c.result) {
        const r = c.result
        const line = (b: typeof r.total) =>
          `<tr><td>${esc(t(b.key === 'Total' ? 'Cmp_Total' : `Cmp_${b.key}`))}</td><td>${Number.isFinite(b.lo) ? `${b.lo.toFixed(0)}–${b.hi.toFixed(0)}` : '—'}</td><td>${b.diffPct == null ? '—' : `${b.diffPct >= 0 ? '+' : ''}${b.diffPct.toFixed(1)} %`}</td></tr>`
        rows.push(
          `<h2>${esc(t('Cmp_Title'))}</h2><table class="grid"><tr><th>${esc(t('Cmp_Band'))}</th><th>nm</th><th>${esc(t('Cmp_Diff'))}</th></tr>${[r.total, ...r.bands].map(line).join('')}<tr><td>${esc(t('Cmp_Shape'))}</td><td></td><td>${r.shapeDiffPct == null ? '—' : `${r.shapeDiffPct.toFixed(1)} %`}</td></tr></table>`,
        )
      }
    }

    if (inc.trans) {
      const tr = getTransState()
      if (tr.saved.length) {
        const head = `<tr><th>${esc(t('Rp_Sample'))}</th><th>τv</th>${['UVA', 'HEV', 'B', 'G', 'R', 'IR'].map((k) => `<th>${k}</th>`).join('')}</tr>`
        const body = tr.saved
          .map((sv) => {
            const lum = luminousTransmittance(sv.curve)
            const b = bandMeans(sv.curve)
            const cell = (k: string) => {
              const x = b.find((y) => y.key === k)
              return `<td>${x?.mean != null ? `${(x.mean * 100).toFixed(1)} %` : '—'}</td>`
            }
            return `<tr><td>${esc(sv.label)}</td><td>${lum.tauV != null ? `${(lum.tauV * 100).toFixed(1)} % (cat. ${lum.category === 5 ? '>4' : lum.category})` : '—'}</td>${['UVA', 'HEV', 'B', 'G', 'R', 'IR'].map(cell).join('')}</tr>`
          })
          .join('')
        rows.push(`<h2>${esc(t('Tr_Title'))}</h2><table class="grid">${head}${body}</table>`)
      }
    }

    // AS7331 UV sensor (when connected and reading)
    const uv = recentUv()
    if (uv) {
      const f = (x: number) => {
        const r = formatIrradiance(x)
        return `${r.value} ${r.unit}`
      }
      rows.push(
        `<h2>${esc(t('Uv_Title'))}</h2><table>${[
          kv('UVA (315–400 nm)', f(uv.uva)),
          kv('UVB (280–315 nm)', f(uv.uvb)),
          kv('UVC (200–280 nm)', f(uv.uvc)),
          kv(t('Uv_Gain'), `${uv.gain}× · ${uv.convMs} ms${uv.flag === 'S' ? ` · ${t('Uv_Saturated')}` : ''}`),
        ].join('')}</table>`,
      )
    }

    if (inc.lines) {
      const ids = identifyPeaks(pipeline.spatialFiltered, pipeline.nmMin, pipeline.nmMax, parseSets(s.LinesSets), s.SecondOrder, 20)
      if (ids.length) {
        rows.push(
          `<h2>${esc(t('Ln_Title'))}</h2><table class="grid"><tr><th>${esc(t('Ln_Measured'))}</th><th>${esc(t('Ln_Match'))}</th><th>Δ nm</th></tr>${ids
            .map(
              (p) =>
                `<tr><td>${p.nm.toFixed(2)}</td><td>${p.match ? esc(`${p.match.order === 2 ? '2× ' : ''}${p.match.line.label} ${p.match.line.nm.toFixed(2)}`) : '—'}</td><td>${p.match ? p.match.delta.toFixed(2) : ''}</td></tr>`,
            )
            .join('')}</table>`,
        )
      }
    }

    return `<!doctype html><html lang="${s.Language === 'POL' ? 'pl' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px auto;max-width:900px;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:2px}
table{border-collapse:collapse;font-size:12px}th,td{padding:3px 8px;text-align:left;vertical-align:top}
table:not(.grid) th{color:#555;font-weight:normal;width:180px}.grid th{background:#f2f2f2}.grid td,.grid th{border:1px solid #ddd}
img{width:100%;border:1px solid #ccc;margin-top:8px}.notes{white-space:pre-wrap;font-size:13px}.warn{color:#a50;font-size:12px}
.bar{margin:12px 0}@media print{.bar{display:none}body{margin:0 auto}}
</style></head><body>
<div class="bar"><button onclick="window.print()">${esc(t('Rp_Print'))}</button></div>
<h1>${esc(title)}</h1><div style="color:#666;font-size:12px">${esc(date)}</div>
${img ? `<img src="${img}" alt="spectrum">` : ''}
${notes ? `<h2>${esc(t('Rp_Notes'))}</h2><div class="notes">${esc(notes)}</div>` : ''}
${rows.join('\n')}
<p style="color:#999;font-size:11px;margin-top:24px">WebSpectrometer2.0 · ${esc(location.href)}</p>
</body></html>`
  }

  const open = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.open()
    w.document.write(build())
    w.document.close()
  }
  const download = () => {
    const safe = title.replace(/[^\w\-]+/g, '_') || 'report'
    downloadText(`${safe}_report.html`, build())
  }

  const cb = (k: keyof typeof inc, label: string) => (
    <label key={k}>
      <input type="checkbox" checked={inc[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} /> {label}
    </label>
  )

  return (
    <FloatingWindow title={t('Rp_Title')} x={pos.x} y={pos.y} width={400} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <label>
          {t('Rp_Heading')}
          <input className="text-box" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {t('Rp_Source')}
          <input className="text-box" style={{ width: '100%' }} value={source} placeholder={t('Rp_SourcePh')} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          {t('Rp_Notes')}
          <textarea className="text-box" style={{ width: '100%', height: 60, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {cb('light', t('Lq_Title'))}
          {cb('compare', t('Cmp_Title'))}
          {cb('trans', t('Tr_Title'))}
          {cb('lines', t('Ln_Title'))}
          {cb('cal', t('Rp_CalPoints'))}
        </div>
        <div className="field-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <ToggleButton onClick={download}>{t('Rp_Download')}</ToggleButton>
          <ToggleButton onClick={open}>{t('Rp_Open')}</ToggleButton>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('Rp_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
