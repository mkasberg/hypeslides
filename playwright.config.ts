import { defineConfig, devices } from '@playwright/test'

// Screenshot baselines are only valid when produced inside the official
// Playwright Docker image (see tools/playwright-docker.sh), so they carry no
// platform suffix.
const PORT = 4173

export default defineConfig({
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }], ['./tests/parity/reporter.ts']],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // `playwright test` without --project runs both; the npm scripts always pick one.
  projects: [
    { name: 'chromium', testDir: './e2e', use: { browserName: 'chromium' } },
    {
      // Hype parity suite (npm run parity); a 1920x1080 viewport so the harness
      // stage is captured 1:1.
      name: 'parity',
      testDir: './tests/parity',
      testMatch: '**/*.spec.ts',
      timeout: 300_000,
      use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
