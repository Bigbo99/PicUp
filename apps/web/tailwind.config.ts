import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        muted: '#475569',
        line: '#D8DEE8',
        surface: '#FFFFFF',
        canvas: '#F7F8FB',
        teal: {
          600: '#0D9488',
          700: '#0F766E'
        }
      },
      boxShadow: {
        panel: '0 18px 50px rgba(15, 23, 42, 0.08)'
      }
    }
  },
  plugins: []
};

export default config;
