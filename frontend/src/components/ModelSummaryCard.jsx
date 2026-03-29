function Stat({ label, value, unit, highlight }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${highlight ? 'text-accent text-glow-accent' : 'text-text-primary'}`}>
        {value !== null && value !== undefined ? (
          <>
            {typeof value === 'number' ? value.toFixed(2) : value}
            {unit && <span className="text-text-muted text-xs ml-1">{unit}</span>}
          </>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </span>
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes) return null
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

export default function ModelSummaryCard({ modelName, result, activeMode }) {
  if (!result) return null
  const { avgTps, avgTtft, avgRam, avgVram, loadTime, size, quantization, promptResults } = result

  return (
    <div className="card p-5 space-y-4">
      {/* Model name */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display font-semibold text-base text-text-primary tracking-wide">{modelName}</p>
          <div className="flex items-center gap-2 mt-1">
            {quantization && (
              <span className="badge bg-violet/10 border border-violet/30 text-violet">{quantization}</span>
            )}
            {size && (
              <span className="badge bg-faint border border-border text-text-muted">{formatBytes(size)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Stat label="Avg TPS" value={avgTps} unit="t/s" highlight />
        <Stat label="Avg TTFT" value={avgTtft} unit="ms" />
        <Stat label="Load Time" value={loadTime !== undefined ? (loadTime / 1000).toFixed(2) : null} unit="s" />
        <Stat label="Avg RAM" value={avgRam} unit="GB" />
        {activeMode !== 'cpu' && (
          <Stat label="Avg VRAM" value={avgVram} unit="GB" />
        )}
      </div>

      {/* Per-prompt results */}
      {promptResults && promptResults.length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">Per Prompt</p>
          <div className="space-y-1">
            {promptResults.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs border-b border-border/40 pb-1">
                <span className="text-text-secondary font-body">{p.label}</span>
                <div className="flex gap-4 font-mono tabular-nums">
                  <span className="text-accent">{p.tps?.toFixed(1)} t/s</span>
                  <span className="text-text-muted">{p.ttft?.toFixed(0)} ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
