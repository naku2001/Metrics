import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import SystemGauges from '../components/SystemGauges'
import ModelSummaryCard from '../components/ModelSummaryCard'

const DEFAULT_PROMPTS = [
  { label: 'Factual',    text: 'What is the capital of France? Answer in one sentence.' },
  { label: 'Reasoning',  text: 'Explain Gödel\'s incompleteness theorems and their implications for artificial intelligence in detail.' },
  { label: 'Creative',   text: 'Write a short poem (4–6 lines) about the feeling of debugging code at 3am.' },
  { label: 'Code',       text: 'Write a Python function implementing binary search on a sorted list, with type hints and a docstring.' },
  { label: 'Summarize',  text: 'Summarize the key differences between supervised, unsupervised, and reinforcement learning.' },
]

function loadSavedPrompts() {
  try {
    const saved = localStorage.getItem('ollama_prompts')
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return DEFAULT_PROMPTS
}

const TPS_MAX = { cpu: 15, nvidia: 120, amd: 100 }

// Chart colors
const COLORS = { tps: '#22d3ee', ttft: '#a78bfa' }

export default function OllamaMetrics({ activeMode }) {
  const [baseUrl, setBaseUrl]           = useState(() => localStorage.getItem('ollama_base_url') || 'http://localhost:11434')
  const [models, setModels]             = useState([])
  const [modelsError, setModelsError]   = useState('')
  const [modelsLoading, setModelsLoading] = useState(true)
  const [selectedModels, setSelectedModels] = useState([])

  const [benchStatus, setBenchStatus]   = useState('idle') // idle | running | done | error
  const [benchError, setBenchError]     = useState('')
  const [currentModel, setCurrentModel] = useState('')
  const [currentPrompt, setCurrentPrompt] = useState('')
  const [liveTokens, setLiveTokens]     = useState({}) // model → accumulated text

  const [prompts, setPrompts]           = useState(loadSavedPrompts)
  const [results, setResults]           = useState({}) // model → result data
  const [systemMetrics, setSystemMetrics] = useState(null)
  const metricsIntervalRef              = useRef(null)

  function updatePrompt(i, field, value) {
    setPrompts(prev => {
      const next = prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p)
      localStorage.setItem('ollama_prompts', JSON.stringify(next))
      return next
    })
  }

  function addPrompt() {
    setPrompts(prev => {
      const next = [...prev, { label: 'Custom', text: '' }]
      localStorage.setItem('ollama_prompts', JSON.stringify(next))
      return next
    })
  }

  function deletePrompt(i) {
    setPrompts(prev => {
      const next = prev.filter((_, idx) => idx !== i)
      localStorage.setItem('ollama_prompts', JSON.stringify(next))
      return next
    })
  }

  function resetPrompts() {
    localStorage.setItem('ollama_prompts', JSON.stringify(DEFAULT_PROMPTS))
    setPrompts(DEFAULT_PROMPTS)
  }

  const yMax = TPS_MAX[activeMode] ?? TPS_MAX.cpu

  // -----------------------------------------------------------------------
  // Load Ollama models on mount / baseUrl change
  // -----------------------------------------------------------------------
  useEffect(() => {
    setModelsLoading(true)
    setModelsError('')
    fetch(`${baseUrl}/api/tags`)
      .then(r => r.json())
      .then(d => {
        setModels(d.models ?? [])
        setModelsLoading(false)
      })
      .catch(() => {
        setModelsError('Ollama is not running. Start it with: OLLAMA_ORIGINS=* ollama serve')
        setModelsLoading(false)
      })
  }, [baseUrl])

  // -----------------------------------------------------------------------
  // System metrics polling
  // -----------------------------------------------------------------------
  const startMetricsPolling = useCallback(() => {
    metricsIntervalRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/system-metrics', {
          headers: { 'X-Hardware-Mode': activeMode },
        })
        setSystemMetrics(await r.json())
      } catch { /* ignore */ }
    }, 2000)
  }, [activeMode])

  const stopMetricsPolling = useCallback(() => {
    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current)
      metricsIntervalRef.current = null
    }
  }, [])

  useEffect(() => () => stopMetricsPolling(), [stopMetricsPolling])

  // -----------------------------------------------------------------------
  // Run benchmark
  // -----------------------------------------------------------------------
  async function runBenchmark() {
    setBenchStatus('running')
    setBenchError('')
    setResults({})
    setLiveTokens({})
    startMetricsPolling()

    try {
      for (const model of selectedModels) {
        setCurrentModel(model)
        const modelResults = []
        const ramSamples = []
        const vramSamples = []
        let loadTime = null

        for (const prompt of prompts) {
          setCurrentPrompt(prompt.label)
          setLiveTokens(prev => ({ ...prev, [model]: '' }))

          const result = await runSinglePrompt(model, prompt, (token) => {
            setLiveTokens(prev => ({ ...prev, [model]: (prev[model] ?? '') + token }))
          })

          modelResults.push({ label: prompt.label, ...result })
          if (loadTime === null) loadTime = result.loadDuration

          // Sample metrics
          try {
            const m = await fetch('/api/system-metrics', { headers: { 'X-Hardware-Mode': activeMode } })
            const md = await m.json()
            ramSamples.push(md.ram_used_gb)
            if (md.vram_used_gb != null) vramSamples.push(md.vram_used_gb)
          } catch { /* ignore */ }
        }

        const avgTps  = modelResults.reduce((s, r) => s + (r.tps ?? 0), 0) / modelResults.length
        const avgTtft = modelResults.reduce((s, r) => s + (r.ttft ?? 0), 0) / modelResults.length
        const avgRam  = ramSamples.length ? ramSamples.reduce((a, b) => a + b, 0) / ramSamples.length : null
        const avgVram = vramSamples.length ? vramSamples.reduce((a, b) => a + b, 0) / vramSamples.length : null

        const modelInfo = models.find(m => m.name === model)

        setResults(prev => ({
          ...prev,
          [model]: {
            avgTps,
            avgTtft,
            avgRam,
            avgVram,
            loadTime,
            size: modelInfo?.size,
            quantization: modelInfo?.details?.quantization_level,
            promptResults: modelResults,
          },
        }))
      }

      setBenchStatus('done')
      setCurrentModel('')
      setCurrentPrompt('')
    } catch (e) {
      setBenchStatus('error')
      setBenchError(e.message)
    } finally {
      stopMetricsPolling()
    }
  }

  async function runSinglePrompt(model, prompt, onToken) {
    const startTime = performance.now()
    let firstTokenTime = null
    let evalCount = 0
    let evalDuration = 0
    let promptEvalCount = 0
    let promptEvalDuration = 0
    let loadDuration = 0

    const r = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: prompt.text, stream: true }),
    })

    if (!r.ok) throw new Error(`Ollama error: ${r.status}`)

    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const d = JSON.parse(line)
          if (d.response) {
            if (firstTokenTime === null) firstTokenTime = performance.now()
            onToken(d.response)
          }
          if (d.done) {
            evalCount        = d.eval_count         ?? 0
            evalDuration     = d.eval_duration      ?? 0
            promptEvalCount  = d.prompt_eval_count  ?? 0
            promptEvalDuration = d.prompt_eval_duration ?? 0
            loadDuration     = d.load_duration      ?? 0
          }
        } catch { /* skip malformed line */ }
      }
    }

    const ttft = firstTokenTime !== null ? firstTokenTime - startTime : null
    const tps  = evalDuration > 0 ? evalCount / (evalDuration / 1e9) : null
    const prefillTps = promptEvalDuration > 0 ? promptEvalCount / (promptEvalDuration / 1e9) : null

    return { tps, ttft, prefillTps, loadDuration, evalCount }
  }

  // -----------------------------------------------------------------------
  // Chart data
  // -----------------------------------------------------------------------
  const chartData = Object.entries(results).map(([model, r]) => ({
    model: model.split(':')[0].split('/').pop(),
    tps:  parseFloat((r.avgTps ?? 0).toFixed(2)),
    ttft: parseFloat((r.avgTtft ?? 0).toFixed(0)),
  }))

  const isRunning = benchStatus === 'running'

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Ollama notice */}
      <div className="flex items-center gap-3 px-4 py-3 border border-warning/20 bg-warning/5 rounded-sm">
        <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs font-mono text-warning/80">
          Ollama must run with CORS enabled:
        </p>
        <code className="ml-auto text-xs font-mono text-warning bg-warning/10 px-2 py-0.5 rounded-sm select-all">
          OLLAMA_ORIGINS=* ollama serve
        </code>
      </div>

      {/* Model selector */}
      <section className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
            01 / Select Models
          </h2>

          {modelsLoading && (
            <span className="text-xs font-mono text-text-muted animate-pulse-slow">Loading models…</span>
          )}
        </div>

        {modelsError ? (
          <div className="flex items-start gap-2 px-3 py-2 border border-danger/30 bg-danger/5 rounded-sm text-xs font-mono text-danger">
            <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            {modelsError}
          </div>
        ) : modelsLoading ? (
          <div className="flex flex-wrap gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton h-8 w-32 rounded-sm" />
            ))}
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm font-mono text-text-muted">No models installed. Run <code className="text-text-secondary">ollama pull llama3.2</code> to add one.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map(m => {
              const sel = selectedModels.includes(m.name)
              const sizeGb = m.size ? (m.size / (1024 ** 3)).toFixed(1) : null
              return (
                <button
                  key={m.name}
                  onClick={() => setSelectedModels(prev =>
                    sel ? prev.filter(x => x !== m.name) : [...prev, m.name]
                  )}
                  disabled={isRunning}
                  className={`px-3 py-2 rounded-sm text-xs font-mono border transition-all duration-150 flex flex-col items-start gap-0.5 ${
                    sel
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border bg-faint text-text-muted hover:border-border-bright hover:text-text-secondary'
                  } disabled:opacity-50`}
                >
                  <span>{m.name}</span>
                  <span className="text-[10px] text-text-muted">
                    {m.details?.quantization_level ?? ''}{sizeGb ? ` · ${sizeGb} GB` : ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <button
          onClick={runBenchmark}
          disabled={isRunning || selectedModels.length === 0}
          className="btn-primary"
        >
          {isRunning ? 'Running Benchmark…' : 'Run Benchmark'}
        </button>

        {benchStatus === 'error' && (
          <p className="text-xs font-mono text-danger">{benchError}</p>
        )}
      </section>

      {/* Prompts editor */}
      <section className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
            02 / Test Prompts
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted">{prompts.length} prompt{prompts.length !== 1 ? 's' : ''}</span>
            <button
              onClick={resetPrompts}
              disabled={isRunning}
              className="text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border hover:border-border-bright px-2 py-1 rounded-sm transition-colors disabled:opacity-40"
            >
              Reset defaults
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {prompts.map((p, i) => (
            <div key={i} className="flex gap-2 items-start group">
              <input
                value={p.label}
                onChange={e => updatePrompt(i, 'label', e.target.value)}
                disabled={isRunning}
                placeholder="Label"
                className="input w-28 flex-shrink-0 text-[11px]"
              />
              <textarea
                value={p.text}
                onChange={e => updatePrompt(i, 'text', e.target.value)}
                disabled={isRunning}
                placeholder="Prompt text…"
                rows={2}
                className="input flex-1 resize-none text-[11px] leading-relaxed"
              />
              <button
                onClick={() => deletePrompt(i)}
                disabled={isRunning || prompts.length <= 1}
                className="mt-1 text-text-muted hover:text-danger transition-colors disabled:opacity-20 flex-shrink-0"
                title="Remove prompt"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addPrompt}
          disabled={isRunning}
          className="text-xs font-mono text-text-muted hover:text-accent border border-dashed border-border hover:border-accent/40 px-3 py-1.5 rounded-sm transition-colors w-full disabled:opacity-40"
        >
          + Add prompt
        </button>
      </section>

      {/* Live status */}
      {isRunning && (
        <section className="card p-6 space-y-4">
          <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
            Live Status
          </h2>
          <div className="flex items-center gap-3 text-sm font-mono">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-accent">{currentModel}</span>
            {currentPrompt && <span className="text-text-muted">/ {currentPrompt}</span>}
          </div>

          {/* Live token stream */}
          {currentModel && liveTokens[currentModel] !== undefined && (
            <div className="bg-base border border-border rounded-sm p-3 font-mono text-xs text-text-secondary leading-relaxed max-h-32 overflow-y-auto">
              {liveTokens[currentModel] || <span className="text-text-muted animate-pulse-slow">Waiting for tokens…</span>}
            </div>
          )}

          <SystemGauges metrics={systemMetrics} activeMode={activeMode} />
        </section>
      )}

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <>
          {/* Summary cards */}
          <section className="space-y-4">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              03 / Model Summary
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(results).map(([model, r]) => (
                <ModelSummaryCard key={model} modelName={model} result={r} activeMode={activeMode} />
              ))}
            </div>
          </section>

          {/* TPS / TTFT bar chart */}
          <section className="card p-6 space-y-4">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              TPS & TTFT Comparison
            </h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* TPS chart */}
              <div>
                <p className="text-xs font-mono text-text-muted mb-3">Tokens / Second (higher = better)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#1e2d42" />
                    <XAxis dataKey="model" tick={{ fill: '#4b6080', fontSize: 11, fontFamily: 'Fira Code' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, yMax]} tick={{ fill: '#4b6080', fontSize: 10, fontFamily: 'Fira Code' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#0c1220', border: '1px solid #1e2d42', borderRadius: 2, fontFamily: 'Fira Code', fontSize: 12 }} itemStyle={{ color: COLORS.tps }} />
                    <Bar dataKey="tps" name="Avg TPS" fill={COLORS.tps} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* TTFT chart */}
              <div>
                <p className="text-xs font-mono text-text-muted mb-3">Time to First Token (ms, lower = better)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#1e2d42" />
                    <XAxis dataKey="model" tick={{ fill: '#4b6080', fontSize: 11, fontFamily: 'Fira Code' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#4b6080', fontSize: 10, fontFamily: 'Fira Code' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#0c1220', border: '1px solid #1e2d42', borderRadius: 2, fontFamily: 'Fira Code', fontSize: 12 }} itemStyle={{ color: COLORS.ttft }} />
                    <Bar dataKey="ttft" name="Avg TTFT (ms)" fill={COLORS.ttft} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Per-prompt table */}
          <section className="card p-6 space-y-6">
            <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
              04 / Per-Prompt Results
            </h2>
            {Object.entries(results).map(([model, r]) => (
              <div key={model} className="space-y-2">
                <p className="font-mono text-xs text-accent">{model}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-mono text-text-muted">Prompt</th>
                        <th className="text-right py-2 px-3 font-mono text-text-muted">TPS</th>
                        <th className="text-right py-2 px-3 font-mono text-text-muted">Prefill TPS</th>
                        <th className="text-right py-2 px-3 font-mono text-text-muted">TTFT (ms)</th>
                        <th className="text-right py-2 px-3 font-mono text-text-muted">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.promptResults?.map((p, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-faint/30 transition-colors">
                          <td className="py-2 px-3 text-text-secondary font-body">{p.label}</td>
                          <td className="py-2 px-3 text-right font-mono text-accent">{p.tps?.toFixed(1) ?? '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-text-secondary">{p.prefillTps?.toFixed(1) ?? '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-text-secondary">{p.ttft?.toFixed(0) ?? '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-text-muted">{p.evalCount ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          {/* System gauges (static, end of run) */}
          {systemMetrics && (
            <section className="card p-6 space-y-4">
              <h2 className="font-display font-semibold tracking-widest uppercase text-sm text-text-secondary">
                System Snapshot
              </h2>
              <SystemGauges metrics={systemMetrics} activeMode={activeMode} />
            </section>
          )}
        </>
      )}
    </div>
  )
}
