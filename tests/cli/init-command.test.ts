/**
 * Verifies the `init` subcommand is registered on the commander program.
 * Importing src/cli.ts is safe: the parseAsync entrypoint is guarded by an
 * import.meta.url === main check, so registration runs but argv is not parsed.
 */

import { describe, it, expect } from 'vitest'
import { program } from '../../src/cli.js'

describe('mrclean CLI', () => {
  it('registers the `init` subcommand', () => {
    const names = program.commands.map((c) => c.name())
    expect(names).toContain('init')
  })
})
