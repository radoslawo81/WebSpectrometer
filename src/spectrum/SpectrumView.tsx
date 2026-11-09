// Spectrum display area (§8): adaptive grid, colored curve, Log transform, peak/dip labels, zoom/pan
// + calibration Trim interaction (§12.2) + hidden peak-label clipboard feature (§8.7)
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getState, markCalibrated, setCalibration, setRuntime, setSettings, useAppState } from '../app/store'
import { useT } from '../i18n'
import { activeResponse, pipeline, reprocessFileData, subscribeFrame } from '../app/engine'
import { extractVisible, updatePeakArea } from '../core/pipeline'
import { valueToY, yToValue } from '../core/logScale'
import { detectPeaks } from '../core/peaks'
import { measureFwhm } from '../core/fwhm'
import { getCompareReference } from '../app/compareStore'
import { linesOf } from '../core/lines'
import { identifyPeaks, secondOrderStart } from '../core/lineIdent'
import { ghostLabel, ghostOrders, GHOST_COLOR, parseSets, SET_COLORS } from '../panels/LinesWindow'
import { SPECTRAL_BANDS } from '../core/bands'
import { wavelengthToCss } from '../core/wavelengthColor'
import { addPoint, clampBin, clampNm, nmToBin, removePoint } from '../core/calibration'

// Peak label hit region (MouseOnLabels): |mx − x| < 20 and |my − y| < 30 against the peak
// line x and the FINAL label y (the value label position when NmCoeff > 50)
interface PeakLabelHit {
  x: number
  y: number
  nm: number
  value: number
}

interface TrimLabelHit {
  cx: number // label center x (hit test |mx-cx| < 20, matching the original source)
  index: number
}

// ShowTrimmingData: TRIM: <nm> nm <±nonlinearity%>; error computed only with >2 points, baseline = interpolation of the two adjacent points, edge points get inverted sign
function showTrimmingData(calib: { bins: number[]; nms: number[] }, i: number): string {
  const nm1 = calib.nms[i]
  let s = `TRIM:  ${nm1.toFixed(2)} nm   `
  if (calib.nms.length > 2) {
    let idx = i
    let invert = false
    if (idx === 0) {
      idx = 1
      invert = true
    }
    if (idx === calib.nms.length - 1) {
      idx = calib.nms.length - 2
      invert = true
    }
    const k = (calib.nms[idx] - calib.nms[idx - 1]) / (calib.nms[idx + 1] - calib.nms[idx - 1])
    const bin2 = calib.bins[idx - 1] + (calib.bins[idx + 1] - calib.bins[idx - 1]) * k
    let pct = (100 * calib.bins[idx]) / bin2 - 100
    if (invert) pct = -pct
    s += `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`
  }
  return s
}

export interface SpectrumMeasure {
  mode: 'value' | 'max'
  value: number
  nm: number
  peakArea: number
}

interface Props {
  onMeasure: (m: SpectrumMeasure) => void
}

const DEST_LEFT = 37 // vertical-axis scale text area
const TOP_BAND = 15 // horizontal-axis scale numbers + calibration label band
const BANDS_H = 16 // web-only: height of the UV/visible/IR band bar under the plot

export const SpectrumView = forwardRef<HTMLCanvasElement | null, Props>(function SpectrumView({ onMeasure }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement)
  const { settings } = useAppState()
  const mouseRef = useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false })
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Add/delete confirmation messages use the current language (handlers are bound once, latest is read via ref)
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  // Hit-test data (filled in during draw)
  const peakLabelsRef = useRef<PeakLabelHit[]>([])
  const trimLabelsRef = useRef<TrimLabelHit[]>([])
  const viewRef = useRef<{ nmStart: number; nmCoeff: number } | null>(null)
  // Clipboard FIFO (§8.7): max 7 lines, dedupe adjacent duplicates; cleared when a new file is loaded
  const clipFifoRef = useRef<string[]>([])
  // Colors rainbow layer cache: key = nm window + width; rebuilt only on change (avoids ~1900 strokes per frame)
  const rainbowRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null)
  const [clipBox, setClipBox] = useState<{ x: number; y: number } | null>(null)
  // Calibration point drag state (matching the original source: record initial values at mouse-down, incremental editing)
  const trimDragRef = useRef<{
    index: number
    startX: number
    initialBin: number
    initialNm: number
    modified: boolean
  } | null>(null)

  // Redraw every frame: subscription is created only once (draw reads the latest settings via settingsRef; the subscription is not torn down/rebuilt while dragging)
  const redrawRef = useRef<() => void>(() => {})
  useEffect(() => {
    let raf = 0
    const redraw = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    }
    redrawRef.current = redraw
    const unsub = subscribeFrame(redraw)
    const obs = new ResizeObserver(redraw)
    if (canvasRef.current?.parentElement) obs.observe(canvasRef.current.parentElement)
    redraw()
    return () => {
      unsub()
      obs.disconnect()
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Settings changes (toggling Colors/LogScale, zooming, etc.) must redraw immediately even when no frames are flowing in
  useEffect(() => {
    redrawRef.current()
  }, [settings])

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const W = parent.clientWidth
    const H = parent.clientHeight
    if (W < 50 || H < 50) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const s = settingsRef.current
    const st = getState()

    // In file mode the display stages re-run before every draw (Prepare_VisibleSamples)
    reprocessFileData()

    // Canvas background AliceBlue
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const win = extractVisible(pipeline, s.StartX, s.EndX)

    const destW = W - 1 - DEST_LEFT // DestWidth = DestW − 1 − DestLeft
    const destH = s.BandsBar ? H - BANDS_H : H // web-only: the band bar takes the bottom strip
    const n = pipeline.numSamples
    const nmMin = pipeline.nmMin
    const nmMax = pipeline.nmMax
    const nmAt = (idx: number) => nmMin + ((nmMax - nmMin) * idx) / n
    const nmStart = nmAt(win.start)
    // NmEnd anchors the LAST visible sample to the right plot edge (SrcX0+SrcDX−1, kx = w/(len−1))
    const nmEnd = nmAt(win.start + win.length - 1)
    const nmCoeff = nmEnd > nmStart ? destW / (nmEnd - nmStart) : 1 // pixels per nm (SetNmCoeff)
    const nmToX = (nm: number) => DEST_LEFT + (nm - nmStart) * nmCoeff
    const maxV = win.maxVisibleValue
    const vToY = (v: number) => valueToY(v, maxV, destH, s.LogScale)

    drawGrid(ctx, W, H, nmStart, nmEnd, nmCoeff, nmToX, maxV, destH, s.LogScale)

    // Curve and coloring (§8.4)
    const idxToX = (i: number) => nmToX(nmAt(win.start + i))
    if (s.Colors && win.length > 1) {
      // The rainbow layer is rebuilt only when the nm window/width changes; just one clip + drawImage per frame
      const rbKey = `${nmStart.toFixed(3)}|${nmEnd.toFixed(3)}|${Math.round(destW)}`
      let rb = rainbowRef.current
      if (!rb || rb.key !== rbKey) {
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(destW))
        c.height = 1
        const rctx = c.getContext('2d')
        if (rctx) {
          for (let px = 0; px < c.width; px++) {
            const nm = nmStart + px / nmCoeff
            rctx.fillStyle = wavelengthToCss(nm)
            rctx.fillRect(px, 0, 1, 1)
          }
        }
        rb = { key: rbKey, canvas: c }
        rainbowRef.current = rb
      }
      // Use the area under the curve as the clipping path
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(idxToX(0), destH)
      for (let i = 0; i < win.length; i++) {
        ctx.lineTo(idxToX(i), vToY(win.values[i]))
      }
      ctx.lineTo(idxToX(win.length - 1), destH)
      ctx.closePath()
      ctx.clip()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(rb.canvas, DEST_LEFT, 0, destW, destH)
      ctx.restore()
    }

    // Dark green polyline RGB(0,70,0)
    ctx.strokeStyle = '#0f2a5c'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < win.length; i++) {
      const x = idxToX(i)
      const y = vToY(win.values[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // If adjacent data points are >2px apart: draw a small 3x3 box at each point
    if (destW / win.length > 2) {
      ctx.fillStyle = '#0f2a5c'
      for (let i = 0; i < win.length; i++) {
        ctx.fillRect(idxToX(i) - 1.5, vToY(win.values[i]) - 1.5, 3, 3)
      }
    }

    // Peak/dip labels (§8.5), following MarkPeak
    viewRef.current = { nmStart, nmCoeff }
    peakLabelsRef.current = []
    if (s.Peaks || s.Dips) {
      // delta is computed against the FULL image width (MarkAllPeaks: (20·SrcDX)\DestW)
      const peaks = detectPeaks(win.values, maxV, W, s.Peaks, s.Dips)
      ctx.font = '12px Arial'
      for (const p of peaks) {
        const nm = nmAt(win.start + p.index)
        const x = idxToX(p.index)
        // The marker anchor stays linear even under Log scale (original quirk: MarkPeak's y1
        // does not go through Y_From_Value, so it detaches from the log-drawn curve)
        const y1 = 15 + Math.round((destH - 15) * (1 - p.value / maxV))
        let y2: number
        if (!p.isDip) {
          // Labels sit in a row near the bottom unless the peak is small (y2 < DestH−50 → DestH−20)
          y2 = y1 - 20
          if (y2 < destH - 50) y2 = destH - 20
          ctx.strokeStyle = 'red'
          ctx.beginPath()
          ctx.moveTo(x + 0.5, y1 + 1)
          ctx.lineTo(x + 0.5, destH)
          ctx.stroke()
        } else {
          y2 = 30
          ctx.strokeStyle = 'green'
          ctx.beginPath()
          ctx.moveTo(x + 0.5, 40)
          ctx.lineTo(x + 0.5, y1 - 3)
          ctx.stroke()
        }
        const label = nmCoeff > 50 ? nm.toFixed(2) : String(Math.round(nm))
        drawPeakLabel(ctx, x, y2, label, false)
        if (nmCoeff > 50) {
          // Secondary value label: above the nm label when it is in the lower half, else below
          y2 = y2 > destH / 2 ? y2 - 16 : y2 + 16
          drawPeakLabel(ctx, x, y2, String(Math.round(p.value)), true)
        }
        peakLabelsRef.current.push({ x, y: y2, nm, value: p.value })
      }
    }

    // Compare reference overlay (web-only): saved reference drawn as a dashed grey line,
    // resampled onto the current wavelength axis; clipped at the top of the graph
    const cmpRef = s.CompareOverlay ? getCompareReference() : null
    if (cmpRef && cmpRef.nmMax > cmpRef.nmMin && win.length > 1) {
      const rn = cmpRef.values.length
      const refAt = (nm: number) => {
        const f = ((nm - cmpRef.nmMin) * rn) / (cmpRef.nmMax - cmpRef.nmMin)
        if (f < 0 || f > rn - 1) return NaN
        const i = Math.floor(f)
        const t = f - i
        return i + 1 < rn ? cmpRef.values[i] * (1 - t) + cmpRef.values[i + 1] * t : cmpRef.values[i]
      }
      ctx.save()
      ctx.strokeStyle = 'rgba(60,60,60,0.85)'
      ctx.lineWidth = 1.2
      ctx.setLineDash([5, 3])
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < win.length; i++) {
        const v = refAt(nmAt(win.start + i))
        if (!Number.isFinite(v)) {
          pen = false
          continue
        }
        const x = idxToX(i)
        const y = Math.max(15, vToY(Math.min(v, maxV)))
        if (pen) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
        pen = true
      }
      ctx.stroke()
      ctx.restore()
    }

    // Response correction (web-only): grey out wavelengths outside the calibration's valid range,
    // where the corrected spectrum is set to 0
    const resp = s.ResponseCorrected ? activeResponse() : null
    if (resp) {
      const shade = (a: number, b: number) => {
        const xa = Math.max(DEST_LEFT, nmToX(a))
        const xb = Math.min(W, nmToX(b))
        if (xb > xa + 1) ctx.fillRect(xa, 15, xb - xa, H - 15)
      }
      ctx.save()
      ctx.fillStyle = 'rgba(120,120,120,0.18)'
      shade(-1e6, resp.validLo)
      shade(resp.validHi, 1e6)
      ctx.restore()
    }

    // FWHM (web-only): measured on the raw samples, drawn as a bar at half maximum.
    // Under Log scale the bar follows the log-drawn curve (vToY); the width itself is unaffected.
    if (s.Fwhm && win.length > 4) {
      const nmPerSample = (nmMax - nmMin) / n
      const minProminence = 0.05 * win.maxPeakValue // ignore noise bumps
      const peaks = detectPeaks(win.values, maxV, W, true, false)
      ctx.font = '11px Inter, "Segoe UI", system-ui, Arial, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 1
      for (const p of peaks) {
        const r = measureFwhm(win.values, p.index, 'local')
        if (!r || r.prominence < minProminence) continue
        const xl = idxToX(r.left)
        const xr = idxToX(r.right)
        const y = Math.round(vToY(r.half)) + 0.5
        ctx.strokeStyle = 'rgb(0,80,220)'
        ctx.beginPath()
        ctx.moveTo(xl, y)
        ctx.lineTo(xr, y)
        ctx.moveTo(xl, y - 4)
        ctx.lineTo(xl, y + 4)
        ctx.moveTo(xr, y - 4)
        ctx.lineTo(xr, y + 4)
        ctx.stroke()
        const label = `${(r.width * nmPerSample).toFixed(nmCoeff > 50 ? 3 : 2)} nm`
        const tw = ctx.measureText(label).width + 6
        // Label to the right of the bar; flip to the left if it would leave the canvas
        const lx = xr + 4 + tw <= W ? xr + 4 : xl - 4 - tw
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fillRect(lx, y - 7, tw, 14)
        ctx.fillStyle = 'rgb(0,80,220)'
        ctx.textAlign = 'left'
        ctx.fillText(label, lx + 3, y + 1)
      }
      ctx.textBaseline = 'alphabetic'
    }

    // Spectral lines (web-only): reference-line overlay, second-order markers/zone, peak identification
    if (s.LinesOverlay || s.LinesIdentify || s.SecondOrder) {
      const sets = parseSets(s.LinesSets)
      const lo = nmAt(win.start)
      const hi = nmAt(win.start + win.length - 1)
      const plotTop = 15
      ctx.save()
      ctx.font = '9px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      if (s.SecondOrder) {
        const so = secondOrderStart(pipeline.spatialFiltered, nmMin, nmMax)
        if (so != null && so < hi) {
          const xa = Math.max(DEST_LEFT, nmToX(so))
          ctx.fillStyle = 'rgba(255,170,60,0.10)'
          ctx.fillRect(xa, plotTop, W - xa, H - plotTop)
          ctx.fillStyle = 'rgb(170,90,0)'
          ctx.textAlign = 'left'
          ctx.fillText(tRef.current('Ln_SecondLabel'), xa + 4, H - 28)
          ctx.textAlign = 'center'
        }
      }
      if (s.LinesOverlay || s.SecondOrder) {
        let lastLabelX = -1e9
        for (const l of linesOf(sets)) {
          const col = SET_COLORS[l.set]
          if (s.LinesOverlay && l.nm >= lo && l.nm <= hi) {
            const x = Math.round(nmToX(l.nm)) + 0.5
            ctx.strokeStyle = col
            ctx.globalAlpha = 0.45
            ctx.setLineDash(l.kind === 'absorption' ? [2, 3] : [])
            ctx.beginPath()
            ctx.moveTo(x, plotTop)
            ctx.lineTo(x, H)
            ctx.stroke()
            ctx.globalAlpha = 1
            if (x - lastLabelX > 34) {
              ctx.fillStyle = col
              ctx.fillText(`${l.label} ${l.nm.toFixed(1)}`, x, plotTop + 2)
              lastLabelX = x
            }
          }
          if (s.SecondOrder && l.kind === 'emission' && l.strength >= 5 && 2 * l.nm >= lo && 2 * l.nm <= hi) {
            const x = Math.round(nmToX(2 * l.nm)) + 0.5
            ctx.strokeStyle = col
            ctx.globalAlpha = 0.6
            ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(x, plotTop + 14)
            ctx.lineTo(x, plotTop + 70)
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.fillStyle = col
            ctx.fillText(`2×${l.label}`, x, plotTop + 72)
          }
        }
        ctx.setLineDash([])
      }
      ctx.restore()
    }

    // Peak identification and higher-order ghosts (web-only). Ghost labels are drawn whenever the
    // 2nd/3rd-order checks are on, line labels only with "Label identified peaks".
    const gOrders = ghostOrders(s)
    if (s.LinesIdentify || gOrders.length) {
      const sets = parseSets(s.LinesSets)
      const lo = nmAt(win.start)
      const hi = nmAt(win.start + win.length - 1)
      ctx.save()
      ctx.textAlign = 'center'
      {
        const ids = identifyPeaks(pipeline.spatialFiltered, nmMin, nmMax, sets, s.SecondOrder, 25, gOrders)
        ctx.font = 'bold 10px Arial'
        ctx.textBaseline = 'bottom'
        for (const p of ids) {
          if (p.nm < lo || p.nm > hi) continue
          if (p.ghost) {
            const x = nmToX(p.nm)
            const y = vToY(p.value) - 4
            const txt = ghostLabel(p, tRef.current, true)
            const tw = ctx.measureText(txt).width
            ctx.strokeStyle = GHOST_COLOR
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(Math.round(x) + 0.5, y - 12)
            ctx.lineTo(Math.round(x) + 0.5, destH)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = 'rgba(255,245,230,0.9)'
            ctx.fillRect(x - tw / 2 - 2, y - 12, tw + 4, 12)
            ctx.fillStyle = GHOST_COLOR
            ctx.fillText(txt, x, y)
            continue
          }
          if (!s.LinesIdentify || !p.match) continue
          const x = nmToX(p.nm)
          const y = p.dip ? vToY(p.value) + 16 : vToY(p.value) - 4
          const txt = `${p.match.order === 2 ? '2×' : ''}${p.match.line.label} ${p.match.line.nm.toFixed(1)}`
          const tw = ctx.measureText(txt).width
          ctx.fillStyle = 'rgba(255,255,255,0.75)'
          ctx.fillRect(x - tw / 2 - 2, y - 12, tw + 4, 12)
          ctx.fillStyle = SET_COLORS[p.match.line.set]
          ctx.fillText(txt, x, y)
        }
      }
      ctx.restore()
    }

    // Saturation (web-only): curve segments whose sensor column has clipped pixels are drawn red,
    // with a warning listing the affected wavelengths
    const sat = pipeline.saturation
    if (sat && win.length > 1) {
      const regions: { a: number; b: number }[] = []
      let start = -1
      for (let i = 0; i <= win.length; i++) {
        const on = i < win.length && sat[win.start + i] >= 2
        if (on && start < 0) start = i
        if (!on && start >= 0) {
          regions.push({ a: start, b: i - 1 })
          start = -1
        }
      }
      if (regions.length) {
        ctx.save()
        ctx.strokeStyle = 'rgb(230,0,0)'
        ctx.lineWidth = 3
        for (const r of regions) {
          ctx.beginPath()
          for (let i = Math.max(0, r.a - 1); i <= Math.min(win.length - 1, r.b + 1); i++) {
            const x = idxToX(i)
            const y = vToY(win.values[i])
            if (i === Math.max(0, r.a - 1)) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        // Warning box: wavelengths of the strongest clipped regions
        const labels = regions
          .map((r) => {
            let im = r.a
            for (let i = r.a; i <= r.b; i++) if (win.values[i] > win.values[im]) im = i
            return { nm: nmAt(win.start + im), v: win.values[im] }
          })
          .sort((p1, p2) => p2.v - p1.v)
          .slice(0, 6)
          .map((l) => l.nm.toFixed(0))
          .sort((x1, x2) => Number(x1) - Number(x2))
        const text = `${tRef.current('Sat_Warning')} ${labels.join(', ')} nm${regions.length > 6 ? ', …' : ''}`
        ctx.font = 'bold 12px Arial'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        const tw = ctx.measureText(text).width
        const bx = DEST_LEFT + 8
        const by = 22
        ctx.fillStyle = 'rgba(255,235,235,0.95)'
        ctx.fillRect(bx, by, tw + 12, 20)
        ctx.strokeStyle = 'rgb(200,0,0)'
        ctx.lineWidth = 1
        ctx.strokeRect(bx + 0.5, by + 0.5, tw + 11, 19)
        ctx.fillStyle = 'rgb(180,0,0)'
        ctx.fillText(text, bx + 6, by + 10)
        ctx.font = '11px Inter, "Segoe UI", system-ui, Arial, sans-serif'
        ctx.fillStyle = 'rgb(120,40,40)'
        ctx.fillText(tRef.current('Sat_Hint'), bx + 2, by + 32)
        ctx.restore()
      }
    }

    // Band bar (web-only): UVC / UVB / UVA / visible colours / IR under the plot
    if (s.BandsBar) {
      const y0 = destH
      ctx.save()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(DEST_LEFT, y0, W - DEST_LEFT, H - y0)
      ctx.font = 'bold 10px Inter, "Segoe UI", system-ui, Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const b of SPECTRAL_BANDS) {
        const xa = Math.max(DEST_LEFT, nmToX(b.lo))
        const xb = Math.min(W, nmToX(b.hi))
        if (xb <= xa) continue
        ctx.fillStyle = b.color
        ctx.fillRect(xa, y0 + 1, xb - xa, H - y0 - 1)
        ctx.strokeStyle = '#ffffff'
        ctx.beginPath()
        ctx.moveTo(Math.round(xa) + 0.5, y0 + 1)
        ctx.lineTo(Math.round(xa) + 0.5, H)
        ctx.stroke()
        const full = tRef.current(b.key)
        const short = tRef.current(`${b.key}_S`)
        const w = xb - xa - 4
        const txt = ctx.measureText(full).width <= w ? full : ctx.measureText(short).width <= w ? short : ''
        if (txt) {
          ctx.fillStyle = b.text
          ctx.fillText(txt, (xa + xb) / 2, y0 + (H - y0) / 2 + 1)
        }
      }
      ctx.restore()
    }

    // Calibration labels (when Trim scale is on; see interaction handlers for dragging/add/delete)
    trimLabelsRef.current = []
    if (s.TrimScale) {
      ctx.font = '12px Arial'
      const calib = st.calibration
      for (let ci = 0; ci < calib.bins.length; ci++) {
        const nm = calib.nms[ci]
        if (nm < nmStart || nm > nmEnd) continue
        const x = nmToX(nm)
        // Solid black line + white dotted line overlaid (alternating dash pattern)
        ctx.strokeStyle = 'black'
        ctx.beginPath()
        ctx.moveTo(x + 0.5, TOP_BAND)
        ctx.lineTo(x + 0.5, destH)
        ctx.stroke()
        ctx.strokeStyle = 'white'
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(x + 0.5, TOP_BAND)
        ctx.lineTo(x + 0.5, destH)
        ctx.stroke()
        ctx.setLineDash([])
        const label = String(Math.round(nm))
        const tw = ctx.measureText(label).width + 8
        drawLabel(ctx, x - tw / 2, 1, tw, 14, label, 'red')
        trimLabelsRef.current.push({ cx: x, index: ci })
      }
    }

    // Measurement (§9): PeakArea smoothed via SmoothValue_Pow_Adaptive (speed=1)
    const pa = updatePeakArea(win, nmMin, nmMax, n)
    const m = mouseRef.current
    if (m.inside) {
      // PrintValueAndNanometers runs anywhere inside the picture box, including x < DestLeft
      const nm = nmStart + (m.x - DEST_LEFT) / nmCoeff
      onMeasure({ mode: 'value', value: yToValue(m.y, maxV, destH, s.LogScale), nm, peakArea: pa })
    } else {
      // Original quirk preserved: Spectrometer_PrintMaxValueAndNanometers maps the bin through
      // full-width pixels ((idx·DestW)\SrcDX) without adding DestLeft before X_To_Nanometers
      const localIdx = win.maxPeakIndex - win.start
      const nm = nmStart + (Math.trunc((localIdx * W) / win.length) - DEST_LEFT) / nmCoeff
      onMeasure({ mode: 'max', value: win.maxPeakValue, nm, peakArea: pa })
    }
  }

  // Wheel zoom / drag pan (§8.7)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = settingsRef.current
      const rect = canvas.getBoundingClientRect()
      // PBox_Spectrum_MouseWheel: the boxes are read as integers, dx = (Δ·EndX − StartX)/2000
      // (original operator-precedence quirk: scales with the absolute EndX, not the span),
      // Ctrl = ×0.1 fine zoom, guaranteed ±1‰ minimum step, k1 deliberately unclamped,
      // fractional results written back; boxes clamp on write with a 20‰ minimum gap
      const startX0 = Math.round(s.StartX)
      const endX0 = Math.round(s.EndX)
      let dx = ((e.deltaY < 0 ? 120 : -120) * endX0 - startX0) / 2000
      if (e.ctrlKey) dx *= 0.1
      if (Math.abs(dx) < 1) dx = Math.sign(dx)
      const k1 = (e.clientX - rect.left - DEST_LEFT) / (rect.width - DEST_LEFT)
      const start = Math.max(0, Math.min(endX0 - 20, startX0 + dx * k1))
      const end = Math.max(startX0 + 20, Math.min(1000, endX0 - dx * (1 - k1)))
      setSettings({ StartX: start, EndX: end })
    }
    let drag: { x: number; startX: number; endX: number } | null = null

    // Hit test (PBox_Spectrum_MouseDown): top band y<15 and |x - label x| < 20
    const hitTrimPoint = (mx: number, my: number): TrimLabelHit | undefined => {
      if (my >= TOP_BAND) return undefined
      return trimLabelsRef.current.find((r) => Math.abs(mx - r.cx) < 20)
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const s = settingsRef.current

      // Calibration label dragging (§12.2): with TrimScale on, TRIM data is shown as soon as the button is pressed
      if (s.TrimScale) {
        const hit = hitTrimPoint(mx, my)
        if (hit) {
          const c = getState().calibration
          trimDragRef.current = {
            index: hit.index,
            startX: mx,
            initialBin: c.bins[hit.index],
            initialNm: c.nms[hit.index],
            modified: false,
          }
          setRuntime({ trimInfo: showTrimmingData(c, hit.index) })
          e.preventDefault()
          return
        }
      }

      // Click near a peak label (±20px / ±30px around the line x and final label y) → clipboard FIFO (§8.7)
      const peak = peakLabelsRef.current.find((r) => Math.abs(mx - r.x) < 20 && Math.abs(my - r.y) < 30)
      if (peak) {
        // MouseOnLabels: value "00000" + two spaces + nm "0.00" (no unit suffix), CRLF-terminated lines
        const line = `${String(Math.round(peak.value)).padStart(5, '0')}  ${peak.nm.toFixed(2)}`
        const fifo = clipFifoRef.current
        if (fifo[fifo.length - 1] !== line) {
          fifo.push(line)
          while (fifo.length > 7) fifo.shift()
        }
        void navigator.clipboard?.writeText(fifo.join('\r\n') + '\r\n').catch(() => undefined)
        // Floating box placement (MouseOnLabels tail): clamp x to the right edge, flip y by half height
        const rect2 = canvas.getBoundingClientRect()
        let bx = peak.x
        if (bx + 80 > rect2.width) bx = rect2.width - 80
        const by = peak.y > rect2.height / 2 ? peak.y - 130 : peak.y + 20
        setClipBox({ x: bx - 14, y: by })
        return
      }

      drag = { x: e.clientX, startX: s.StartX, endX: s.EndX }
    }

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      mouseRef.current = { x: mx, y: my, inside: true }

      // Calibration point being dragged (PBox_Spectrum_MouseMove): incremental, zoom scales with visible window width
      const td = trimDragRef.current
      if (td) {
        const c = getState().calibration
        const s = settingsRef.current
        const dx = mx - td.startX
        const zoom = (0.001 * (s.EndX - s.StartX)) / window.innerWidth
        let newCalib = c
        if (e.ctrlKey) {
          // CTRL+drag: edit NM (increment dx*zoom*100, clamped to ±0.25 of neighboring points)
          const nm = clampNm(c, td.index, td.initialNm + dx * zoom * 100)
          const nms = [...c.nms]
          nms[td.index] = nm
          newCalib = { bins: c.bins, nms }
        } else {
          // Drag: edit BIN (increment dx*zoom*2000, clamped to ±1 of neighboring points)
          const bin = clampBin(c, td.index, td.initialBin + dx * zoom * 2000, pipeline.numSamples)
          const bins = [...c.bins]
          bins[td.index] = bin
          newCalib = { bins, nms: c.nms }
        }
        td.modified = true
        setCalibration(newCalib, pipeline.numSamples)
        setRuntime({ trimInfo: showTrimmingData(newCalib, td.index) })
        return
      }

      if (drag) {
        // PBox_Spectrum_MouseMove pan: divisor is the FULL picture-box width and the
        // values stay fractional (txt NumericValue keeps decimals)
        const diff = drag.endX - drag.startX
        const dx = ((e.clientX - drag.x) * diff) / rect.width
        let start = drag.startX - dx
        let end = drag.endX - dx
        if (start < 0) start = 0
        if (start + diff > 1000) start = 1000 - diff
        if (end > 1000) end = 1000
        if (end - diff < 0) end = diff
        setSettings({ StartX: start, EndX: end })
      }
    }

    const onUp = () => {
      drag = null
      if (trimDragRef.current) {
        // Mark as "calibrated" only if actually modified (setCalibration already saved to localStorage in real time)
        if (trimDragRef.current.modified) markCalibrated()
        trimDragRef.current = null
        setRuntime({ trimInfo: null })
      }
      setClipBox(null) // clipboard floating box disappears when the left button is released
    }

    const onLeave = () => {
      mouseRef.current.inside = false
    }

    // Right-click: top scale band = add/delete calibration points (PBox_Spectrum_MouseDown right-button branch)
    const onContextMenu = (e: MouseEvent) => {
      const s = settingsRef.current
      if (!s.TrimScale) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      if (my >= TOP_BAND) return // original source: both add and delete are restricted to the top band y<15
      const st = getState()

      const hit = hitTrimPoint(mx, my)
      if (hit) {
        if (st.calibration.bins.length < 3) {
          alert(tRef.current('Msg_CanNotDelete'))
          return
        }
        if (confirm(tRef.current('Msg_Delete'))) {
          const c = removePoint(st.calibration, hit.index)
          if (c) {
            setCalibration(c, pipeline.numSamples)
            markCalibrated()
          }
        }
        return
      }

      if (mx >= DEST_LEFT) {
        const view = viewRef.current
        if (!view) return
        if (confirm(tRef.current('Msg_NewTrimPoint'))) {
          const nm = view.nmStart + (mx - DEST_LEFT) / view.nmCoeff
          const bin = nmToBin(st.calibration, nm)
          setCalibration(addPoint(st.calibration, bin, nm), pipeline.numSamples)
          markCalibrated()
        }
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mouseup', onUp)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="spectrum-canvas" />
      {clipBox && (
        <div
          style={{
            position: 'absolute',
            left: clipBox.x,
            top: Math.max(0, clipBox.y),
            width: 90,
            height: 120,
            background: 'lightyellow',
            border: '1px solid green',
            font: '11px Arial',
            padding: 3,
            whiteSpace: 'pre',
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {'Clipboard data\n' + clipFifoRef.current.join('\n')}
        </div>
      )}
    </>
  )
})

// Peak/dip label (MarkPeak): yellow box with green border at fixed widths, left edge at x−14,
// text left-aligned at x−13; widths step with the text length exactly like the original
function drawPeakLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, isValue: boolean) {
  let w = 26
  if (isValue) {
    if (text.length > 3) w = 34
    if (text.length > 4) w = 41
  } else {
    if (text.length > 3) w = 30
    if (text.length > 4) w = 37
    if (text.length > 5) w = 44
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(x - 14, y, w, 14)
  ctx.strokeStyle = '#0f2a5c'
  ctx.lineWidth = 1
  ctx.strokeRect(x - 14 + 0.5, y + 0.5, w - 1, 13)
  ctx.fillStyle = '#0f2a5c'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x - 13, y + 8)
  ctx.textBaseline = 'alphabetic'
}

// Yellow-background label (peak = green border, calibration = red border)
function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  border: string,
) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = '#0f2a5c'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, x + w / 2, y + h / 2 + 1)
  ctx.textAlign = 'left'
}

// Adaptive grid (§8.2)
function drawGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nmStart: number,
  nmEnd: number,
  nmCoeff: number,
  nmToX: (nm: number) => number,
  maxV: number,
  destH: number,
  logK: number,
) {
  const pens = ['#64748b', '#a3afbf', '#d3dae3', '#e6eaf0', '#f2f4f7'] // modern theme: soft scientific grid
  ctx.font = '11px Inter, "Segoe UI", system-ui, Arial, sans-serif'
  ctx.textBaseline = 'alphabetic'

  // Horizontal axis: nm grid
  const steps: { mod: number; penIf: number; pen: number; labelIf: number }[] = [
    { mod: 100, penIf: 0, pen: 0, labelIf: 0 },
    { mod: 50, penIf: 1, pen: 1, labelIf: 2 },
    { mod: 10, penIf: 2, pen: 2, labelIf: 5 },
    { mod: 1, penIf: 20, pen: 3, labelIf: 50 },
    { mod: 0.1, penIf: 40, pen: 4, labelIf: Infinity },
  ]
  const drawn = new Set<number>()
  for (const st of steps) {
    if (nmCoeff <= st.penIf) continue
    const first = Math.ceil(nmStart / st.mod) * st.mod
    for (let nm = first; nm <= nmEnd; nm += st.mod) {
      const key = Math.round(nm * 10)
      if (drawn.has(key)) continue
      drawn.add(key)
      const x = Math.round(nmToX(nm)) + 0.5
      ctx.strokeStyle = pens[st.pen]
      ctx.beginPath()
      ctx.moveTo(x, TOP_BAND)
      ctx.lineTo(x, H)
      ctx.stroke()
      if (nmCoeff > st.labelIf || st.mod === 100) {
        ctx.fillStyle = '#334155'
        ctx.textAlign = 'center'
        const label = st.mod < 1 ? nm.toFixed(1) : String(Math.round(nm))
        ctx.fillText(label, x, 11)
      }
    }
  }

  // Vertical axis (scale Y): grid lines sit at UNIFORM pixel spacing — every 5%, 100%=Pen1,
  // multiples of 10%=Pen2, others=Pen3 — and the label every 10% is Y_To_Value at that pixel,
  // so under Log scale the lines stay evenly spaced and the labels become non-round values
  ctx.textAlign = 'right'
  for (let p = 0; p <= 100; p += 5) {
    const y = Math.round(destH - (p / 100) * (destH - 15)) + 0.5
    ctx.strokeStyle = p === 100 ? pens[0] : p % 10 === 0 ? pens[1] : pens[2]
    ctx.beginPath()
    ctx.moveTo(DEST_LEFT, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  ctx.fillStyle = 'black'
  for (let p = 10; p <= 100; p += 10) {
    const y = destH - (p / 100) * (destH - 15)
    const v = yToValue(y, maxV, destH, logK)
    const label = v >= 100000 ? `${Math.round(v / 1000)}K` : String(Math.round(v))
    ctx.fillText(label, 35, y + 4)
  }
  ctx.textAlign = 'left'
}
