/**
 * Canary round-trip helpers for mrclean doctor.
 *
 * runHookCanary: spawns dist/cli.js hook with a synthetic UserPromptSubmit payload
 *   containing CANARY_STRING, asserts the hook exits 0 and stdout contains the
 *   "mrclean active" wiring banner in hookSpecificOutput.additionalContext.
 *
 * runMcpCanary: spawns dist/mcp.js via StdioClientTransport, calls the `sanitize`
 *   tool with CANARY_STRING, asserts the response echoes it back unchanged.
 *
 * Neither function calls process.exit — they return { ok, detail }.
 *
 * Plan 01-05, RESEARCH §4.2.
 */

import { spawnSync } from 'node:child_process'

/**
 * Stable canary string injected into doctor self-test payloads.
 * Detection layers in Phase 2+ can fast-path this prefix without spending
 * detection budget on self-test traffic.
 */
export const CANARY_STRING = 'MRCLEAN_CANARY_PHASE1_DOCTOR_TEST'

/**
 * Round-trip a canary payload through the mrclean hook binary.
 *
 * Sends a synthetic UserPromptSubmit JSON on stdin. Verifies:
 *   1. Hook exits 0.
 *   2. stdout is valid JSON.
 *   3. hookSpecificOutput.additionalContext starts with "mrclean active v".
 *
 * Returns { ok: true, detail } on success; { ok: false, detail } on any failure.
 */
export async function runHookCanary(
  nodePath: string,
  mrcleanBin: string,
): Promise<{ ok: boolean; detail: string }> {
  const payload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'doctor-canary',
    transcript_path: '/tmp/doctor-canary',
    cwd: process.cwd(),
    prompt: `doctor canary: ${CANARY_STRING}`,
  })

  const result = spawnSync(nodePath, [mrcleanBin, 'hook'], {
    input: payload,
    encoding: 'utf8',
    timeout: 5_000,
  })

  if (result.error) {
    return { ok: false, detail: `hook spawn error: ${result.error.message}` }
  }

  if (result.status !== 0) {
    const firstErrLine = (result.stderr ?? '').split('\n')[0] ?? ''
    return {
      ok: false,
      detail: `hook exited ${String(result.status)}: ${firstErrLine}`,
    }
  }

  if (!result.stdout || result.stdout.trim() === '') {
    // Empty stdout is valid JSON for a pass-through, but we need the banner.
    // UserPromptSubmit should emit the banner via additionalContext.
    // Empty means no banner — FAIL.
    return { ok: false, detail: 'hook stdout was empty — wiring banner not found' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    return {
      ok: false,
      detail: `hook stdout is not valid JSON: ${result.stdout.slice(0, 100)}`,
    }
  }

  // Check for wiring banner in hookSpecificOutput.additionalContext
  const ctx =
    (parsed as { hookSpecificOutput?: { additionalContext?: string } })?.hookSpecificOutput
      ?.additionalContext ?? ''

  if (typeof ctx !== 'string' || !ctx.startsWith('mrclean active v')) {
    return {
      ok: false,
      detail: `hook stdout did not contain wiring banner (additionalContext: ${String(ctx).slice(0, 100)})`,
    }
  }

  return { ok: true, detail: 'hook canary round-tripped; wiring banner present' }
}

/**
 * Round-trip a canary payload through the mrclean MCP server's `sanitize` tool.
 *
 * Spawns dist/mcp.js via StdioClientTransport, performs the MCP initialize handshake,
 * calls `sanitize({ text: CANARY_STRING })`, and asserts:
 *   1. content[0].text === CANARY_STRING (echo semantics)
 *
 * Returns { ok: true, detail } on success; { ok: false, detail } on any failure.
 * Closes the client in a finally block to avoid process leaks.
 */
export async function runMcpCanary(
  nodePath: string,
  mcpBin: string,
): Promise<{ ok: boolean; detail: string }> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

  const transport = new StdioClientTransport({ command: nodePath, args: [mcpBin] })
  const client = new Client(
    { name: 'mrclean-doctor', version: '0.0.0' },
    { capabilities: {} },
  )

  try {
    await client.connect(transport)

    const result = await client.callTool({
      name: 'sanitize',
      arguments: { text: CANARY_STRING },
    })

    const echoed = (
      result.content as Array<{ type: string; text: string }>
    )?.[0]?.text

    if (echoed !== CANARY_STRING) {
      return {
        ok: false,
        detail: `MCP sanitize did not echo canary string; got: ${String(echoed).slice(0, 100)}`,
      }
    }

    return { ok: true, detail: 'MCP canary round-tripped through sanitize tool' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: `MCP client error: ${msg}` }
  } finally {
    await client.close().catch(() => {})
  }
}
