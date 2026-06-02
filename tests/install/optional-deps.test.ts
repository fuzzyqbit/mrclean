/**
 * MODEL-01 invariant: ML deps declared as optionalDependencies, absent from dependencies.
 *
 * Rationale (Pitfall 2 + Pitfall 7 from .planning/research/PITFALLS.md):
 *   - A failed native onnxruntime-node build (musl/Alpine/exotic arch — it is glibc-linked
 *     with no WASM auto-fallback in Node) must NEVER break the core secret tool install.
 *   - Declaring the ML deps under `optionalDependencies` lets npm skip-on-failure; the core
 *     mrclean package installs and runs with zero ML deps present.
 *   - The `dependencies` block must stay ML-free so the supply chain surface remains minimal.
 *
 * These tests read package.json directly (no network, no npm install) to enforce the
 * structural guarantee at the dependency-declaration layer. Runtime import-isolation
 * (never static-importing ML deps on a cold path) is enforced in Phase 5/6.
 *
 * See also: docs/SCOPE-FENCE.md §"In-Scope Allowlist" for the rationale and
 * docs/SCOPE-FENCE.md §"Transition Checklist" for per-phase verification steps.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  files?: string[]
}

const ML_DEPS = ['@huggingface/transformers', 'onnxruntime-node'] as const

function loadPackageJson(): PackageJson {
  const raw = readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8')
  return JSON.parse(raw) as PackageJson
}

describe('MODEL-01: ML optional dependency structure', () => {
  it('optionalDependencies block exists and contains both ML deps', () => {
    const pkg = loadPackageJson()

    expect(pkg.optionalDependencies).toBeDefined()
    expect(pkg.optionalDependencies).not.toBeNull()

    for (const dep of ML_DEPS) {
      expect(
        pkg.optionalDependencies?.[dep],
        `Expected "${dep}" in optionalDependencies`
      ).toBeTruthy()
    }
  })

  it('dependencies block contains neither ML dep (core tree stays ML-free)', () => {
    const pkg = loadPackageJson()

    for (const dep of ML_DEPS) {
      expect(
        pkg.dependencies?.[dep],
        `"${dep}" must NOT appear in dependencies — declare it in optionalDependencies only`
      ).toBeUndefined()
    }
  })

  it('devDependencies block contains neither ML dep', () => {
    const pkg = loadPackageJson()

    for (const dep of ML_DEPS) {
      expect(
        pkg.devDependencies?.[dep],
        `"${dep}" must NOT appear in devDependencies — declare it in optionalDependencies only`
      ).toBeUndefined()
    }
  })

  it('files publish allow-list does not enumerate model weights or ML runtime artifacts', () => {
    const pkg = loadPackageJson()
    const filesAllowList = pkg.files ?? []

    // Model weights (.onnx, .bin), ONNX runtime binaries, and HF cache dirs must not
    // be explicitly enumerated in the publish list — they are never part of the bundle.
    const ML_ARTIFACT_PATTERNS = [
      /\.onnx$/i,
      /\.bin$/i,
      /onnxruntime/i,
      /transformers/i,
      /huggingface/i,
      /\.cache/i,
      /models\//i,
    ]

    for (const entry of filesAllowList) {
      for (const pattern of ML_ARTIFACT_PATTERNS) {
        expect(
          pattern.test(entry),
          `files[] entry "${entry}" matches ML artifact pattern ${pattern} — remove it`
        ).toBe(false)
      }
    }
  })

  it('@huggingface/transformers version range is compatible with ^4.2.0', () => {
    const pkg = loadPackageJson()
    const version = pkg.optionalDependencies?.['@huggingface/transformers'] ?? ''
    // Must declare a caret range starting at 4.x (^4.2.0 or compatible)
    expect(version).toMatch(/^\^4\.\d+\.\d+$/)
  })

  it('onnxruntime-node version range is compatible with ^1.24.3', () => {
    const pkg = loadPackageJson()
    const version = pkg.optionalDependencies?.['onnxruntime-node'] ?? ''
    // Must declare a caret range starting at 1.24.x or later minor
    expect(version).toMatch(/^\^1\.\d+\.\d+$/)
  })
})
