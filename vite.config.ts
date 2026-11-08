import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `base: './'` lets the built app run from any static server path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
