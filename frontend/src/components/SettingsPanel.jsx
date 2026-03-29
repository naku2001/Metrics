import { useEffect, useRef, useState } from 'react'

const MODE_OPTIONS = [
  { value: 'cpu',    label: 'CPU' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'amd',    label: 'AMD' },
]

export default function SettingsPanel({ open, onClose, hardware, activeMode, onModeOverride }) {
  const [apiKey, setApiKey]         = useState('')
  const [orModel, setOrModel]       = useState(() => localStorage.getItem('or_model') || 'anthropic/claude-3-haiku')
  const [ollamaUrl, setOllamaUrl]   = useState(() => localStorage.getItem('ollama_base_url') || 'http://localhost:11434')
  const [keySaved, setKeySaved]     = useState(false)
  const [keyError, setKeyError]     = useState('')
  const [clearing, setClearing]     = useState(false)
  const [clearMsg, setClearMsg]     = useState('')
  const [override, setOverride]     = useState(() => localStorage.getItem('hardware_mode_override') || '')
  const panelRef = useRef(null)

  // Close on backdrop click
  useEffect(() => {
    function handle(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    function handle(e) { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  async function saveApiKey() {
    setKeyError('')
    setKeySaved(false)
    try {
      const r = await fetch('/api/settings/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, model: orModel }),
      })
      if (!r.ok) throw new Error(await r.text())
      setKeySaved(true)
      setApiKey('')
      localStorage.setItem('or_model', orModel)
      setTimeout(() => setKeySaved(false), 3000)
    } catch (e) {
      setKeyError(e.message)
    }
  }

  function saveOllamaUrl() {
    localStorage.setItem('ollama_base_url', ollamaUrl)
  }

  async function clearCache() {
    setClearing(true)
    setClearMsg('')
    try {
      const r = await fetch('/api/cache', { method: 'DELETE' })
      const d = await r.json()
      setClearMsg(`Cleared ${d.deleted} cached file${d.deleted !== 1 ? 's' : ''}`)
    } catch {
      setClearMsg('Failed to clear cache')
    } finally {
      setClearing(false)
      setTimeout(() => setClearMsg(''), 4000)
    }
  }

  function handleModeChange(mode) {
    const next = mode === override ? '' : mode
    setOverride(next)
    onModeOverride(next || null)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-base/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-96 bg-panel border-l border-border flex flex-col animate-slide-in shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-primary">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          {/* Hardware section */}
          <section className="space-y-4">
            <SectionLabel>Hardware</SectionLabel>

            {/* Auto-detected badge */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono text-text-muted">Auto-detected</label>
              <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-sm bg-base">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  hardware?.mode === 'nvidia' ? 'bg-accent' :
                  hardware?.mode === 'amd'    ? 'bg-orange-400' : 'bg-text-muted'
                }`} />
                <span className="font-mono text-sm text-text-secondary">
                  {hardware ? (
                    hardware.mode === 'cpu'    ? 'CPU Only' :
                    hardware.mode === 'nvidia' ? `NVIDIA GPU${hardware.gpu_name ? ` · ${hardware.gpu_name}` : ''}` :
                                                `AMD GPU${hardware.gpu_name ? ` · ${hardware.gpu_name}` : ''}`
                  ) : 'Detecting…'}
                </span>
                {hardware?.vram_total_gb && hardware.mode !== 'cpu' && (
                  <span className="ml-auto font-mono text-xs text-text-muted">{hardware.vram_total_gb} GB VRAM</span>
                )}
              </div>
            </div>

            {/* Override toggle */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono text-text-muted">Mode Override</label>
              <div className="flex gap-1">
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleModeChange(opt.value)}
                    className={`flex-1 py-2 text-xs font-mono font-semibold tracking-wider uppercase rounded-sm border transition-all duration-150 ${
                      override === opt.value
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border bg-faint text-text-muted hover:border-border-bright hover:text-text-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {override && (
                <p className="text-[10px] font-mono text-warning">
                  Override active — sends X-Hardware-Mode: {override} on all requests
                </p>
              )}
            </div>
          </section>

          {/* OpenRouter */}
          <section className="space-y-3">
            <SectionLabel>OpenRouter</SectionLabel>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-or-v1-…"
              className="input"
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
            />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono text-text-muted">Model</label>
              <input
                type="text"
                value={orModel}
                onChange={e => setOrModel(e.target.value)}
                placeholder="anthropic/claude-3-haiku"
                className="input text-xs"
              />
              <p className="text-[10px] font-mono text-text-muted">
                Any model from <span className="text-text-secondary">openrouter.ai/models</span>
              </p>
            </div>
            <button onClick={saveApiKey} disabled={!apiKey} className="btn-primary w-full">
              Save Key
            </button>
            {keySaved && <p className="text-xs font-mono text-success">✓ Saved to .env</p>}
            {keyError && <p className="text-xs font-mono text-danger">{keyError}</p>}
            <p className="text-[10px] font-mono text-text-muted leading-relaxed">
              Key stored in <code className="text-text-secondary">backend/.env</code> only.
            </p>
          </section>

          {/* Ollama URL */}
          <section className="space-y-3">
            <SectionLabel>Ollama Base URL</SectionLabel>
            <input
              type="text"
              value={ollamaUrl}
              onChange={e => setOllamaUrl(e.target.value)}
              className="input"
              onBlur={saveOllamaUrl}
              onKeyDown={e => e.key === 'Enter' && saveOllamaUrl()}
            />
            <p className="text-[10px] font-mono text-text-muted">Stored in localStorage.</p>
          </section>

          {/* Cache */}
          <section className="space-y-3">
            <SectionLabel>Cache</SectionLabel>
            <p className="text-xs font-mono text-text-muted">
              Cached QA pairs are stored in <code className="text-text-secondary">backend/cache/</code>
            </p>
            <button
              onClick={clearCache}
              disabled={clearing}
              className="btn-ghost w-full text-danger border-danger/30 hover:border-danger/60 hover:text-danger"
            >
              {clearing ? 'Clearing…' : 'Clear Cache'}
            </button>
            {clearMsg && (
              <p className="text-xs font-mono text-text-secondary">{clearMsg}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest border-b border-border pb-1.5">
      {children}
    </p>
  )
}
