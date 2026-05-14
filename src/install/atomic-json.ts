/**
 * Atomic JSON file operations.
 *
 * All writes use the tmp-in-same-dir + rename pattern to guarantee atomicity
 * and avoid cross-filesystem rename failures (Pitfall #5: os.tmpdir() may be
 * on a different filesystem than ~/.claude/).
 *
 * RESEARCH.md §3.3 (atomic write + backup naming).
 */

import { readFile, writeFile, rename, copyFile, readdir, unlink } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Read and parse a JSON file.
 * Returns an empty object (`{}`) if the file does not exist (ENOENT).
 * Re-throws all other errors (permission denied, parse errors, etc.).
 */
export async function readJsonOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ENOENT') {
      return {}
    }
    throw err
  }
}

/**
 * Atomically write JSON data to a file.
 *
 * Writes to a tmp file in the SAME directory as the target (Pitfall #5 defense),
 * then renames the tmp file to the target. If the rename fails, the tmp file
 * is cleaned up in a finally block to avoid leaving orphaned files.
 */
export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path)
  const tmpPath = join(dir, `.mrclean-tmp-${randomUUID()}.json`)

  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmpPath, path)
  } catch (err) {
    // Clean up tmp file if rename failed
    try {
      await unlink(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}

/**
 * Create a timestamped backup of a JSON file.
 *
 * Naming: `<target>.mrclean-backup-<ISO8601-safe>.json`
 * where ISO8601-safe replaces `:` and `.` with `-`.
 * Example: `settings.json.mrclean-backup-2026-05-14T12-34-56-789Z.json`
 *
 * Returns the backup file path.
 * Throws if the target file does not exist.
 */
export async function backupJson(target: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${target}.mrclean-backup-${ts}.json`
  await copyFile(target, backupPath)
  return backupPath
}

/**
 * List all mrclean backup files for a given target, sorted newest-first.
 *
 * Scans the directory containing `target` for files matching:
 * `<basename(target)>.mrclean-backup-*.json`
 *
 * Returns full paths sorted by the timestamp portion (newest first).
 */
export async function listMrcleanBackups(target: string): Promise<string[]> {
  const dir = dirname(target)
  const base = basename(target)
  const prefix = `${base}.mrclean-backup-`

  const entries = await readdir(dir)
  const backups = entries.filter(
    (name) => name.startsWith(prefix) && name.endsWith('.json')
  )

  // Sort by the timestamp suffix (lexicographic sort works because timestamps are ISO-formatted)
  backups.sort((a, b) => {
    const tsA = a.slice(prefix.length, -'.json'.length)
    const tsB = b.slice(prefix.length, -'.json'.length)
    return tsB.localeCompare(tsA) // descending (newest first)
  })

  return backups.map((name) => join(dir, name))
}

/**
 * Restore a target file from a backup.
 *
 * Copies `backup` over `target` atomically using copyFile.
 * Caller is responsible for creating a pre-restore backup if desired.
 */
export async function restoreFromBackup(target: string, backup: string): Promise<void> {
  await copyFile(backup, target)
}
