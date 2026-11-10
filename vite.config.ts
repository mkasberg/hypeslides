import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// `base: './'` lets the built app run from any static server path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // The render harness (parity suite, future exports) is a second page.
      input: { main: resolve(import.meta.dirname, 'index.html'), harness: resolve(import.meta.dirname, 'harness.html') },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
