/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          bg:      '#020617',   // slate-950
          surface: '#0f172a',   // slate-900
          card:    '#1e293b',   // slate-800
          border:  '#334155',   // slate-700
          accent:  '#6366f1',   // indigo-500
          muted:   '#64748b',   // slate-500
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
      },
    },
  },
  plugins: [],
};
