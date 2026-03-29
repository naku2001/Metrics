import { useEffect, useState } from 'react'
import EmbeddingBenchmark from './tabs/EmbeddingBenchmark'
import OllamaMetrics from './tabs/OllamaMetrics'
import SettingsPanel from './components/SettingsPanel'
import HardwareBadge from './components/HardwareBadge'

const TABS = [
  { id: 'embedding', label: 'Embedding Benchmark' },
  { id: 'ollama',    label: 'Ollama LLM Metrics' },
]

export default function App() {
  const [activeTab, setActiveTab]       = useState('embedding')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hardware, setHardware]         = useState(null)
  const [hwError, setHwError]           = useState(false)
  const [, forceRender]                 = useState(0)

  // Resolve active hardware mode: localStorage override takes priority
  const activeMode = (() => {
    const override = localStorage.getItem('hardware_mode_override')
    if (override && ['cpu', 'nvidia', 'amd'].includes(override)) return override
    return hardware?.mode ?? 'cpu'
  })()

  // Re-derive activeMode when override changes
  useEffect(() => {
    const handler = () => forceRender(n => n + 1)
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    fetch('/api/hardware')
      .then(r => r.json())
      .then(setHardware)
      .catch(() => setHwError(true))
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-base dot-grid">
      {/* Header */}
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-screen-2xl mx-auto px-6 flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse-slow" />
            <span className="font-display font-bold tracking-[0.2em] uppercase text-sm text-text-primary">
              AI Bench
            </span>
            <span className="text-text-muted font-mono text-xs tracking-widest">/ DASHBOARD</span>
          </div>

          {/* Hardware badge + settings */}
          <div className="flex items-center gap-4">
            <HardwareBadge hardware={hardware} error={hwError} activeMode={activeMode} />
            <button
              onClick={() => setSettingsOpen(true)}
              className="btn-ghost flex items-center gap-2 text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-6 py-8">
        {activeTab === 'embedding' && (
          <EmbeddingBenchmark activeMode={activeMode} />
        )}
        {activeTab === 'ollama' && (
          <OllamaMetrics activeMode={activeMode} />
        )}
      </main>

      {/* Settings panel */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hardware={hardware}
        activeMode={activeMode}
        onModeOverride={mode => {
          if (mode) localStorage.setItem('hardware_mode_override', mode)
          else localStorage.removeItem('hardware_mode_override')
          // Force re-render by triggering a storage event equivalent
          window.dispatchEvent(new Event('storage'))
        }}
      />
    </div>
  )
}
