/**
 * Project-root .gitignore manager.
 *
 * Writes a mrclean-managed block between marker delimiters to the project-root
 * .gitignore file (NOT .mrclean/.gitignore — resolves OQ-1 from RESEARCH.md §10).
 *
 * Phase 1 policy: the managed block contains a single entry `.mrclean/` that
 * ignores the ENTIRE .mrclean/ directory. Operators who want to commit
 * config.toml or words.txt must edit .gitignore manually (documented in SUMMARY).
 *
 * RESEARCH.md §10 OQ-1, Phase 1 interface spec.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'
import { GITIGNORE_BEGIN, GITIGNORE_END } from './markers.js'

const GITIGNORE_BLOCK = `${GITIGNORE_BEGIN}
.mrclean/
${GITIGNORE_END}`

/**
 * Add the mrclean managed block to the project-root .gitignore.
 *
 * - Creates .gitignore if it does not exist.
 * - If the managed block already exists, replaces it (idempotent).
 * - Existing user content is preserved above and below the block.
 * - Writes atomically via tmp-in-same-dir + rename.
 */
export async function addGitignoreEntries(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore')
  const existing = await readFileOrEmpty(gitignorePath)

  // Remove any existing managed block first (for idempotency)
  const stripped = removeBlock(existing)

  // Ensure the file does not end with more than one blank line before appending
  const base = stripped.trimEnd()
  const separator = base.length > 0 ? '\n\n' : ''
  const newContent = `${base}${separator}${GITIGNORE_BLOCK}\n`

  await atomicWriteText(gitignorePath, newContent)
}

/**
 * Remove the mrclean managed block from the project-root .gitignore.
 *
 * - If no managed block is present, this is a no-op.
 * - If the resulting file is empty or whitespace-only, deletes the file.
 * - Writes atomically via tmp-in-same-dir + rename.
 */
export async function removeGitignoreEntries(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore')
  const existing = await readFileOrEmpty(gitignorePath)

  if (!existing.includes(GITIGNORE_BEGIN)) {
    // No managed block — nothing to do
    return
  }

  const stripped = removeBlock(existing)

  if (stripped.trim().length === 0) {
    // Delete the file if it's now empty
    try {
      await unlink(gitignorePath)
    } catch {
      // File may already be gone — ignore
    }
    return
  }

  await atomicWriteText(gitignorePath, stripped)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') return ''
    throw err
  }
}

/**
 * Remove the mrclean managed block (including its delimiters) from content.
 * Returns the content with the block stripped out.
 */
function removeBlock(content: string): string {
  const beginIdx = content.indexOf(GITIGNORE_BEGIN)
  if (beginIdx === -1) return content

  const endIdx = content.indexOf(GITIGNORE_END, beginIdx)
  if (endIdx === -1) {
    // Malformed — missing end marker; strip from begin to end of file
    return content.slice(0, beginIdx).trimEnd() + '\n'
  }

  const afterEnd = content.slice(endIdx + GITIGNORE_END.length)
  const before = content.slice(0, beginIdx)

  // Trim trailing whitespace from 'before', trim leading newlines from 'afterEnd'
  const cleanBefore = before.trimEnd()
  const cleanAfter = afterEnd.replace(/^\n+/, '')

  if (cleanBefore.length === 0 && cleanAfter.length === 0) {
    return ''
  }
  if (cleanBefore.length === 0) {
    return cleanAfter
  }
  if (cleanAfter.length === 0) {
    return cleanBefore + '\n'
  }
  return cleanBefore + '\n' + cleanAfter
}

/** Write text atomically using tmp-in-same-dir + rename (mirrors atomic-json pattern). */
async function atomicWriteText(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  const tmpPath = join(dir, `.mrclean-gi-tmp-${randomUUID()}`)
  try {
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, path)
  } catch (err) {
    try {
      await unlink(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}
