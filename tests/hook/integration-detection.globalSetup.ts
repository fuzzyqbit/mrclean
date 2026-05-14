/**
 * vitest globalSetup — runs ONCE before tests/hook/integration-detection.test.ts.
 *
 * Unconditional build (no timestamp-heuristic — that approach is unreliable when
 * dist/cli.js timestamp equals src/ timestamp after a clean checkout).
 *
 * Plan 02-05: this setup file is registered in vitest.config.ts globalSetup array.
 */
import { execSync } from 'node:child_process'

export default async function globalSetup() {
  execSync('npm run build', {
    stdio: 'inherit',
    timeout: 90_000, // 90s ceiling
    cwd: process.cwd(),
  })
}
