/**
 * Vitest configuration with unit + integration project split.
 *
 * Motivation (RESEARCH §Pattern 6 / Pitfall #4):
 * Phase 2 ran all tests in a single flat config with a top-level globalSetup that
 * executed `tsup --clean` (deleting dist/ and rebuilding) before the suite.  When
 * vitest ran tests in parallel, unit tests importing dist/ artefacts would race with
 * the mid-run clean.  This caused non-deterministic failures in
 * tests/doctor/end-to-end.test.ts and tests/install/idempotency.test.ts.
 *
 * Fix: split tests into two named projects:
 *   - unit   — all tests except the integration set; runs in parallel (fast).
 *   - integration — install, doctor e2e, hook integration, fixtures corpus, perf;
 *                   runs with fileParallelism:false (sequential) and owns the
 *                   globalSetup tsup build so it never races with unit reads.
 *
 * Coverage thresholds are declared at the workspace level and enforced by
 * `npm run test:coverage` (vitest run --coverage).  Values are locked by
 * CONTEXT.md §"Quality Gates (QA-01..03)":
 *   lines: 80, statements: 80, functions: 75, branches: 70
 *
 * The src/mcp/tools/{sanitize,restore,audit-query}.ts files are excluded from
 * coverage because they are deleted in plan 03-01; excluding them now avoids
 * dead-code coverage holes after deletion.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ---------------------------------------------------------------------------
    // Coverage — workspace-level; applies across both projects.
    // ---------------------------------------------------------------------------
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // Deleted in plan 03-01 — exclude now to avoid dead-code holes
        'src/mcp/tools/sanitize.ts',
        'src/mcp/tools/restore.ts',
        'src/mcp/tools/audit-query.ts',
        'tests/**',
        'vendor/**',
        'dist/**',
        'scripts/**',
        '*.config.ts',
        'tests/fixtures/**',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 70,
      },
    },

    // ---------------------------------------------------------------------------
    // Projects — two named projects for parallel-pollution isolation.
    // ---------------------------------------------------------------------------
    projects: [
      // -------------------------------------------------------------------------
      // unit — all tests except integration-sensitive ones; runs in parallel.
      // -------------------------------------------------------------------------
      {
        test: {
          name: 'unit',
          environment: 'node',
          testTimeout: 30_000,
          include: ['tests/**/*.test.ts'],
          exclude: [
            'tests/install/**',
            'tests/doctor/end-to-end.test.ts',
            'tests/hook/integration.test.ts',
            'tests/hook/integration-detection.test.ts',
            'tests/fixtures-corpus.test.ts',
            'tests/fixtures-corpus-bundle.test.ts',
            'tests/perf/**',
          ],
          // No globalSetup — unit tests must NOT trigger tsup --clean
        },
      },

      // -------------------------------------------------------------------------
      // integration — install, doctor e2e, hook integration, fixtures corpus,
      //               perf tests; sequential (fileParallelism:false) to avoid
      //               dist/ race with tsup --clean in globalSetup.
      // -------------------------------------------------------------------------
      {
        test: {
          name: 'integration',
          environment: 'node',
          testTimeout: 60_000,
          fileParallelism: false,
          globalSetup: ['./tests/hook/integration-detection.globalSetup.ts'],
          include: [
            'tests/install/**/*.test.ts',
            'tests/doctor/end-to-end.test.ts',
            'tests/hook/integration.test.ts',
            'tests/hook/integration-detection.test.ts',
            'tests/fixtures-corpus.test.ts',
            'tests/fixtures-corpus-bundle.test.ts',
            'tests/perf/**/*.test.ts',
          ],
        },
      },
    ],
  },
})
