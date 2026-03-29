/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base:     '#060a12',
        surface:  '#0c1220',
        elevated: '#111827',
        panel:    '#0f1928',
        border:   '#1e2d42',
        'border-bright': '#2a3f5c',
        accent:   '#22d3ee',
        'accent-dim': '#0891b2',
        violet:   '#a78bfa',
        'violet-dim': '#7c3aed',
        muted:    '#4b6080',
        faint:    '#243347',
        success:  '#34d399',
        warning:  '#fbbf24',
        danger:   '#f87171',
        'text-primary':   '#e2e8f0',
        'text-secondary': '#94a3b8',
        'text-muted':     '#4b6080',
      },
      fontFamily: {
        display: ['"Rajdhani"', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
        mono:    ['"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(34,211,238,0.15)',
        'glow-violet': '0 0 20px rgba(167,139,250,0.15)',
        'inner-glow':  'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'grid-faint': 'radial-gradient(circle, #1e2d42 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-sm': '24px 24px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-in':   'slideIn 0.35s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideIn: { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
}
