// Small SVG line chart for the web-only windows (time log, absorbance)
export interface ChartSeries {
  points: [number, number][]
  color: string
  width?: number
  dash?: string
}

interface Props {
  series: ChartSeries[]
  width: number
  height: number
  xFormat?: (x: number) => string
  yFormat?: (y: number) => string
  yLabel?: string
  markers?: { x: number; color: string; label?: string }[]
  yMin?: number
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

export function MiniChart({ series, width, height, xFormat = (x) => x.toFixed(0), yFormat = (y) => y.toPrecision(3), yLabel, markers, yMin }: Props) {
  const pad = { l: 46, r: 8, t: 8, b: 20 }
  const pts = series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (pts.length < 2) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', border: '1px solid #bbb', background: 'rgb(240,248,255)' }}>—</div>
  }
  let x0 = Math.min(...pts.map((p) => p[0]))
  let x1 = Math.max(...pts.map((p) => p[0]))
  let y0 = yMin ?? Math.min(...pts.map((p) => p[1]))
  let y1 = Math.max(...pts.map((p) => p[1]))
  if (x1 === x0) x1 = x0 + 1
  if (y1 === y0) {
    y1 += Math.abs(y0) * 0.05 + 1
    y0 -= Math.abs(y0) * 0.05 + (yMin != null ? 0 : 1)
  }
  const yr = y1 - y0
  if (yMin == null) y0 -= yr * 0.05
  y1 += yr * 0.05
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (width - pad.l - pad.r)
  const Y = (y: number) => height - pad.b - ((y - y0) / (y1 - y0)) * (height - pad.t - pad.b)
  const xt = niceTicks(x0, x1, 5)
  const yt = niceTicks(y0, y1, 4)
  return (
    <svg width={width} height={height} style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 4 }}>
      {xt.map((x) => (
        <g key={`x${x}`}>
          <line x1={X(x)} x2={X(x)} y1={pad.t} y2={height - pad.b} stroke="rgb(210,210,210)" />
          <text x={X(x)} y={height - 6} fontSize={10} textAnchor="middle">
            {xFormat(x)}
          </text>
        </g>
      ))}
      {yt.map((y) => (
        <g key={`y${y}`}>
          <line x1={pad.l} x2={width - pad.r} y1={Y(y)} y2={Y(y)} stroke="rgb(215,215,215)" />
          <text x={pad.l - 3} y={Y(y) + 3} fontSize={10} textAnchor="end">
            {yFormat(y)}
          </text>
        </g>
      ))}
      {yLabel && (
        <text x={4} y={pad.t + 8} fontSize={10}>
          {yLabel}
        </text>
      )}
      {markers?.map((m, i) => (
        <g key={`m${i}`}>
          <line x1={X(m.x)} x2={X(m.x)} y1={pad.t} y2={height - pad.b} stroke={m.color} strokeDasharray="4 3" />
          {m.label && (
            <text x={X(m.x) + 3} y={pad.t + 10} fontSize={10} fill={m.color}>
              {m.label}
            </text>
          )}
        </g>
      ))}
      {series.map((s, i) => {
        let d = ''
        let pen = false
        for (const [x, y] of s.points) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            pen = false
            continue
          }
          d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.max(y0, Math.min(y1, y))).toFixed(1)}`
          pen = true
        }
        return <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.5} strokeDasharray={s.dash} />
      })}
    </svg>
  )
}
