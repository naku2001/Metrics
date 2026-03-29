const MODE_META = {
  cpu:    { label: 'CPU Only',   color: 'text-text-secondary border-border',  dot: 'bg-text-muted' },
  nvidia: { label: 'NVIDIA GPU', color: 'text-accent border-accent/30',        dot: 'bg-accent' },
  amd:    { label: 'AMD GPU',    color: 'text-orange-400 border-orange-400/30', dot: 'bg-orange-400' },
}

export default function HardwareBadge({ hardware, error, activeMode }) {
  if (error) {
    return (
      <span className="badge border border-danger/30 text-danger">
        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
        HW detection failed
      </span>
    )
  }

  if (!hardware) {
    return (
      <span className="badge border border-border text-text-muted animate-pulse-slow">
        <span className="w-1.5 h-1.5 rounded-full bg-muted" />
        Detecting…
      </span>
    )
  }

  const meta = MODE_META[activeMode] ?? MODE_META.cpu
  const isOverride = activeMode !== hardware.mode

  return (
    <span className={`badge border font-mono ${meta.color} gap-2`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
      {hardware.gpu_name && (
        <span className="text-text-muted font-normal">· {hardware.gpu_name}</span>
      )}
      {hardware.vram_total_gb && activeMode !== 'cpu' && (
        <span className="text-text-muted font-normal">{hardware.vram_total_gb} GB</span>
      )}
      {isOverride && (
        <span className="text-warning text-[10px] uppercase tracking-wider ml-1">override</span>
      )}
    </span>
  )
}
