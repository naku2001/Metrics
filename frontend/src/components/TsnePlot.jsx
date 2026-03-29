import { useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const CLUSTER_COLORS = [
  '#22d3ee', '#a78bfa', '#34d399', '#fbbf24',
  '#f87171', '#60a5fa', '#f472b6', '#4ade80',
]

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="card p-3 max-w-xs shadow-glow-accent border-accent/30 text-xs">
      <p className="font-mono text-accent mb-1">{d.chunk_id}</p>
      <p className="text-text-secondary leading-relaxed">{d.text?.slice(0, 160)}…</p>
    </div>
  )
}

export default function TsnePlot({ tsne }) {
  const [hoveredCluster, setHoveredCluster] = useState(null)
  if (!tsne) return null

  const { coords, labels, chunk_texts } = tsne

  const data = coords.map(([x, y], i) => ({
    x,
    y,
    cluster: labels[i],
    chunk_id: `chunk_${i}`,
    text: chunk_texts[i] ?? '',
  }))

  const clusters = [...new Set(labels)]

  return (
    <div>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 0 }}>
          <XAxis
            dataKey="x" type="number" name="x"
            tick={false} axisLine={{ stroke: '#1e2d42' }} tickLine={false}
          />
          <YAxis
            dataKey="y" type="number" name="y"
            tick={false} axisLine={{ stroke: '#1e2d42' }} tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#2a3f5c' }} />
          {clusters.map(cluster => (
            <Scatter
              key={cluster}
              name={`Cluster ${cluster}`}
              data={data.filter(d => d.cluster === cluster)}
              opacity={hoveredCluster === null || hoveredCluster === cluster ? 1 : 0.2}
            >
              {data
                .filter(d => d.cluster === cluster)
                .map((_, i) => (
                  <Cell
                    key={i}
                    fill={CLUSTER_COLORS[cluster % CLUSTER_COLORS.length]}
                    fillOpacity={0.75}
                    r={5}
                  />
                ))}
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-center">
        {clusters.map(c => (
          <button
            key={c}
            className="flex items-center gap-1.5 text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
            onMouseEnter={() => setHoveredCluster(c)}
            onMouseLeave={() => setHoveredCluster(null)}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: CLUSTER_COLORS[c % CLUSTER_COLORS.length] }}
            />
            Cluster {c}
          </button>
        ))}
      </div>
    </div>
  )
}
