function ArcGauge({ label, value, max, unit, color = '#22d3ee', size = 100 }) {
  const pct = Math.min((value ?? 0) / max, 1)
  const r = 38
  const cx = 50
  const cy = 54
  const startAngle = -210
  const sweepAngle = 240

  function polarToXY(angle, radius) {
    const rad = (angle * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  function describeArc(startDeg, endDeg, radius) {
    const start = polarToXY(endDeg, radius)
    const end = polarToXY(startDeg, radius)
    const largeArc = endDeg - startDeg > 180 ? 1 : 0
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`
  }

  const endAngle = startAngle + sweepAngle * pct
  const trackPath = describeArc(startAngle, startAngle + sweepAngle, r)
  const valuePath = pct > 0 ? describeArc(startAngle, endAngle, r) : null

  const displayVal = value !== null && value !== undefined ? value : '—'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox="0 0 100 100">
        {/* Track */}
        <path d={trackPath} fill="none" stroke="#1e2d42" strokeWidth={7} strokeLinecap="round" />
        {/* Value arc */}
        {valuePath && (
          <path
            d={valuePath}
            fill="none"
            stroke={color}
            strokeWidth={7}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
          />
        )}
        {/* Value text */}
        <text
          x="50" y="52"
          textAnchor="middle" dominantBaseline="middle"
          fill="#e2e8f0"
          fontSize="14"
          fontFamily="'Fira Code', monospace"
          fontWeight="500"
        >
          {typeof displayVal === 'number' ? displayVal.toFixed(1) : displayVal}
        </text>
        <text
          x="50" y="67"
          textAnchor="middle"
          fill="#4b6080"
          fontSize="7"
          fontFamily="'Fira Code', monospace"
        >
          {unit}
        </text>
      </svg>
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">{label}</span>
    </div>
  )
}

export default function SystemGauges({ metrics, activeMode }) {
  if (!metrics) {
    return (
      <div className="flex gap-6 items-center">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton w-24 h-24 rounded-full" />
        ))}
      </div>
    )
  }

  const showVram = activeMode !== 'cpu'

  return (
    <div className="flex flex-wrap gap-6 items-end">
      <ArcGauge
        label="RAM"
        value={metrics.ram_percent}
        max={100}
        unit="%"
        color="#22d3ee"
      />
      <div className="flex flex-col items-center gap-2">
        <ArcGauge
          label="CPU"
          value={metrics.cpu_percent}
          max={100}
          unit="%"
          color="#a78bfa"
        />
        {/* Per-core mini bars */}
        {metrics.cpu_per_core && (
          <div className="flex gap-0.5 items-end h-5">
            {metrics.cpu_per_core.map((c, i) => (
              <div
                key={i}
                className="w-1.5 bg-violet-dim/60 rounded-t-[1px] transition-all duration-300"
                style={{ height: `${Math.max(4, c / 100 * 20)}px` }}
                title={`Core ${i}: ${c.toFixed(0)}%`}
              />
            ))}
          </div>
        )}
      </div>
      {showVram && (
        <ArcGauge
          label="VRAM"
          value={metrics.vram_percent}
          max={100}
          unit="%"
          color="#34d399"
        />
      )}
      {/* RAM detail */}
      <div className="flex flex-col gap-1 text-xs font-mono text-text-muted ml-2">
        <span>RAM {metrics.ram_used_gb?.toFixed(1)} / {metrics.ram_total_gb} GB</span>
        {showVram && metrics.vram_total_gb && (
          <span>VRAM {metrics.vram_used_gb?.toFixed(1)} / {metrics.vram_total_gb} GB</span>
        )}
      </div>
    </div>
  )
}
