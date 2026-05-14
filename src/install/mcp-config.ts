/**
 * Atomic read/write of ~/.claude.json for MCP server registration.
 *
 * MCP servers go into ~/.claude.json under `projects[cwd].mcpServers`
 * (NOT ~/.claude/settings.json — see Pitfall #1 in RESEARCH.md).
 *
 * RESEARCH.md §2.2 (MCP server JSON shape), §3.2 (idempotency).
 */

import { access, constants } from 'node:fs/promises'
import { readJsonOrEmpty, atomicWriteJson, backupJson } from './atomic-json.js'

interface McpServerEntry {
  type: 'stdio'
  command: string
  args: string[]
}

/**
 * Write the mrclean MCP server entry into ~/.claude.json.
 *
 * Entry path: `projects[projectCwd].mcpServers.mrclean`
 * Shape: `{ type: 'stdio', command: nodePath, args: [mcpBinPath] }`
 *
 * Idempotent: re-running overwrites the existing `mrclean` key (self-upgrade).
 * Creates a timestamped backup before writing if the file exists.
 *
 * @param claudeJsonPath - Absolute path to ~/.claude.json
 * @param nodePath       - Absolute path to the Node.js binary
 * @param mcpBinPath     - Absolute path to dist/mcp.js
 * @param projectCwd     - Absolute path to the project directory (key in `projects`)
 */
export async function writeMcpServerEntry(
  claudeJsonPath: string,
  nodePath: string,
  mcpBinPath: string,
  projectCwd: string,
): Promise<void> {
  const data = await readJsonOrEmpty(claudeJsonPath)

  // Ensure nested structure exists
  if (typeof data.projects !== 'object' || data.projects === null || Array.isArray(data.projects)) {
    data.projects = {}
  }

  const projects = data.projects as Record<string, Record<string, unknown>>

  if (typeof projects[projectCwd] !== 'object' || projects[projectCwd] === null) {
    projects[projectCwd] = {}
  }

  const project = projects[projectCwd]

  if (typeof project.mcpServers !== 'object' || project.mcpServers === null || Array.isArray(project.mcpServers)) {
    project.mcpServers = {}
  }

  const mcpServers = project.mcpServers as Record<string, McpServerEntry>

  // Write/overwrite the mrclean entry (idempotent key-based)
  mcpServers.mrclean = {
    type: 'stdio',
    command: nodePath,
    args: [mcpBinPath],
  }

  // Backup before writing if file exists
  try {
    await access(claudeJsonPath, constants.F_OK)
    await backupJson(claudeJsonPath)
  } catch {
    // File does not exist yet — no backup needed
  }

  await atomicWriteJson(claudeJsonPath, data)
}

/**
 * Remove the mrclean MCP server entry from ~/.claude.json.
 *
 * Leaves other servers and other projects untouched.
 * Leaves an empty `mcpServers: {}` if mrclean was the only entry (preserves structure).
 * Creates a timestamped backup before writing.
 *
 * @param claudeJsonPath - Absolute path to ~/.claude.json
 * @param projectCwd     - Absolute path to the project directory
 */
export async function removeMcpServerEntry(
  claudeJsonPath: string,
  projectCwd: string,
): Promise<void> {
  const data = await readJsonOrEmpty(claudeJsonPath)

  const projects = data.projects as Record<string, Record<string, unknown>> | undefined
  if (!projects) return

  const project = projects[projectCwd]
  if (!project) return

  const mcpServers = project.mcpServers as Record<string, unknown> | undefined
  if (!mcpServers || !('mrclean' in mcpServers)) return

  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete mcpServers.mrclean

  await backupJson(claudeJsonPath)
  await atomicWriteJson(claudeJsonPath, data)
}
