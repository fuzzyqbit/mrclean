import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // globalSetup runs ONCE before the full test suite.
    // Plan 02-05: unconditional `npm run build` ensures dist/cli.js is current
    // for integration tests (no fragile timestamp-heuristic approach).
    globalSetup: ['./tests/hook/integration-detection.globalSetup.ts'],
    // Bump testTimeout for integration tests that spawn processes (default 5s is too short)
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
})
