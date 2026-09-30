import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Palace-page tests finish in a few seconds alone and cross the 5s default when the full suite shares this sync disk.
    testTimeout: 15000,
  },
})
