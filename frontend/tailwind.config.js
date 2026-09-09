/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Public Sans"', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#00183b',
          container: '#0f2d59',
          on: '#ffffff',
          'on-container': '#7c95c8',
        },
        secondary: {
          DEFAULT: '#9b4500',
          container: '#fd8a42',
          on: '#ffffff',
          'on-container': '#682c00',
        },
        tertiary: {
          DEFAULT: '#001e09',
          container: '#003614',
          on: '#ffffff',
          'on-container': '#46a860',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
          on: '#ffffff',
          'on-container': '#93000a',
        },
        surface: {
          DEFAULT: '#f8f9ff',
          dim: '#ccdbf3',
          bright: '#f8f9ff',
          container: '#e6eeff',
          'container-low': '#eff4ff',
          'container-lowest': '#ffffff',
          'container-high': '#dce9ff',
          'container-highest': '#d5e3fc',
          on: '#0d1c2e',
          'on-variant': '#44474f',
        },
        outline: {
          DEFAULT: '#747780',
          variant: '#c4c6d0',
        },
        background: {
          DEFAULT: '#f8f9ff',
          on: '#0d1c2e',
        },
        brand: {
          navy: '#0F2D59',
          'navy-hover': '#1A365D',
          brass: '#B45309',
          green: '#15803D',
          'green-light': '#DCFCE7',
          red: '#B91C1C',
          'red-light': '#FEE2E2',
          amber: '#FEF3C7',
          'amber-text': '#B45309',
          slate: '#0F172A',
          'slate-muted': '#64748B',
          'slate-border': '#E2E8F0',
          'slate-border-dark': '#CBD5E1',
          bg: '#F8FAFC',
        }
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
    },
  },
  plugins: [],
}
