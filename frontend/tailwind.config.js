/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./../components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Vercel-style near-black monochrome ground — no navy, no radium glow.
        base: {
          DEFAULT: '#000000',
          panel: '#0A0A0A',
          raised: '#161616',
          border: '#2E2E2E',
          borderSoft: '#1F1F1F',
        },
        ink: {
          DEFAULT: '#FAFAFA',
          dim: '#A1A1A1',
          faint: '#707070',
        },
        // Chrome accent is monochrome white (Vercel's default button treatment) —
        // color now lives only in the semantic risk scale and chart data below.
        accent: {
          DEFAULT: '#FFFFFF',
          soft: 'rgba(255,255,255,0.08)',
          strong: '#E5E5E5',
        },
        risk: {
          critical: '#F1493F',
          high: '#F0A23D',
          medium: '#3291FF',
          low: '#2CB67D',
        },
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'sans-serif'],
        sans: ['"IBM Plex Sans"', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 12px 32px -16px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(255,255,255,0.14)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(241,73,63,0.55)' }, '70%': { boxShadow: '0 0 0 12px rgba(241,73,63,0)' }, '100%': { boxShadow: '0 0 0 0 rgba(241,73,63,0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-up': 'fade-up .35s ease both',
        'pulse-ring': 'pulse-ring 1.8s infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
