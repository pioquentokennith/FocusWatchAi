import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-desktop',
  timeout: 90000,
  workers: 1,
  outputDir: 'test-results/desktop',
})
