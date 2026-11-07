// HDR window (web-only): combine a short and a long exposure into one spectrum
import { useState } from 'react'
import { FloatingWindow } from '../components/FloatingWindow'
import { ToggleButton } from '../components/ToggleButton'
import { useT } from '../i18n'
import { loadDataIntoPipeline, pipeline } from '../app/engine'
import { setRuntime } from '../app/store'
import { mergeHdr, type HdrResult, type HdrShot } from '../core/hdr'
import { downloadText } from '../core/files'
import { useWindowPos } from './useWindowPos'

function shot(): HdrShot {
  return {
    nmMin: pipeline.nmMin,
    nmMax: pipeline.nmMax,
    values: Array.from(pipeline.spatialFiltered),
    saturated: pipeline.saturation ? Array.from(pipeline.saturation) : null,
  }
}

const satCount = (s: HdrShot | null) => (s?.saturated ? s.saturated.filter((x) => x >= 2).length : 0)

export function HdrWindow({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [pos, onMove] = useWindowPos('hdr', { x: 380, y: 130 })
  const [short, setShort] = useState<HdrShot | null>(null)
  const [long, setLong] = useState<HdrShot | null>(null)
  const [res, setRes] = useState<HdrResult | string | null>(null)

  const merge = () => {
    if (!short || !long) return
    setRes(mergeHdr(short, long))
  }
  const ok = res && typeof res !== 'string' ? res : null

  const nmsOf = (s: HdrShot) => s.values.map((_, i) => s.nmMin + ((s.nmMax - s.nmMin) * i) / s.values.length)

  const show = () => {
    if (!ok || !long) return
    loadDataIntoPipeline(nmsOf(long), ok.values)
    setRuntime({ fileMode: 'HDR', fileMeta: [] })
  }
  const save = () => {
    if (!ok || !long) return
    const nms = nmsOf(long)
    downloadText('hdr_spectrum.csv', `Nanometers;Intensity\n${ok.values.map((v, i) => `${nms[i].toFixed(2)};${v.toFixed(1)}`).join('\n')}\n`)
  }

  return (
    <FloatingWindow title={t('Hd_Title')} x={pos.x} y={pos.y} width={420} onMove={onMove} onClose={onClose} className="compare-window">
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <div style={{ fontSize: 11, color: 'rgb(90,90,90)' }}>{t('Hd_Intro')}</div>
        <div className="field-row" style={{ gap: 6 }}>
          <ToggleButton active={!!short} onClick={() => (setShort(shot()), setRes(null))} style={{ flex: 1 }}>
            1. {t('Hd_Short')}
          </ToggleButton>
          <ToggleButton active={!!long} onClick={() => (setLong(shot()), setRes(null))} style={{ flex: 1 }}>
            2. {t('Hd_Long')}
          </ToggleButton>
        </div>
        <div style={{ fontSize: 11 }}>
          {short && (
            <div style={{ color: satCount(short) ? 'rgb(190,0,0)' : 'rgb(0,110,0)' }}>
              {t('Hd_ShortState').replace('{n}', String(satCount(short)))}
            </div>
          )}
          {long && <div>{t('Hd_LongState').replace('{n}', String(satCount(long)))}</div>}
        </div>
        <div className="field-row" style={{ gap: 6 }}>
          <ToggleButton onClick={merge} style={{ flex: 1 }}>
            3. {t('Hd_Merge')}
          </ToggleButton>
        </div>
        {typeof res === 'string' && <div style={{ color: 'rgb(190,0,0)', fontSize: 11 }}>{t(res)}</div>}
        {ok && (
          <>
            <div style={{ fontSize: 11 }}>
              {t('Hd_Result').replace('{k}', ok.k.toFixed(2)).replace('{r}', String(ok.replaced)).replace('{o}', String(ok.overlap))}
            </div>
            <div className="field-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <ToggleButton onClick={save}>{t('Hd_Save')}</ToggleButton>
              <ToggleButton onClick={show}>{t('Hd_Show')}</ToggleButton>
            </div>
          </>
        )}
        <div style={{ fontSize: 10, color: 'rgb(120,120,120)' }}>{t('Hd_Hint')}</div>
      </div>
    </FloatingWindow>
  )
}
