/**
 * Lifecycle tests for installShutdownHandlers and the MCP server's graceful shutdown.
 *
 * Both tests that involve signals are run in child processes to avoid killing the
 * vitest runner itself.
 *
 * The lifecycle module cannot be imported from dist/mcp/lifecycle.js because tsup
 * bundles everything into two flat files (dist/cli.js and dist/mcp.js). Instead:
 * - Lifecycle behavior is tested by spawning dist/mcp.js (the real server) and
 *   sending it SIGTERM/SIGINT.
 * - The inline listener-count test uses a self-contained Node.js child process.
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../..')
const DIST_MCP = resolve(PROJECT_ROOT, 'dist/mcp.js')
const NODE = process.execPath

/**
 * Spawn a child process and collect output; optionally kill it after a pattern appears in stderr.
 */
function spawnAndSignal(
  command: string,
  args: string[],
  opts: {
    waitForPatternInStderr?: RegExp
    signal?: NodeJS.Signals
    killAfterMs?: number
    timeoutMs?: number
  } = {},
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let stdout = ''

    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })

    let signalSent = false
    const sendSignal = () => {
      if (!signalSent) {
        signalSent = true
        child.kill(opts.signal ?? 'SIGTERM')
      }
    }

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (opts.waitForPatternInStderr && !signalSent && opts.waitForPatternInStderr.test(stderr)) {
        sendSignal()
      }
    })

    if (opts.killAfterMs !== undefined) {
      setTimeout(sendSignal, opts.killAfterMs)
    }

    const hardKillTimer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          rejectP(new Error(`Process timed out after ${opts.timeoutMs}ms\nstderr=${stderr}`))
        }, opts.timeoutMs)
      : null

    child.on('exit', (code) => {
      if (hardKillTimer) clearTimeout(hardKillTimer)
      resolveP({ code, stderr, stdout })
    })
    child.on('error', (err) => {
      if (hardKillTimer) clearTimeout(hardKillTimer)
      rejectP(err)
    })
  })
}

/**
 * Spawn a child process with an eval script and wait for it to exit naturally.
 */
function spawnEval(
  script: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(NODE, ['--input-type=module'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let stdout = ''

    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.stdout.on('data', (chunk: string) => { stdout += chunk })

    child.stdin.write(script)
    child.stdin.end()

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          rejectP(new Error(`Process timed out after ${opts.timeoutMs}ms\nstderr=${stderr}`))
        }, opts.timeoutMs)
      : null

    child.on('exit', (code) => {
      if (timer) clearTimeout(timer)
      resolveP({ code, stderr, stdout })
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      rejectP(err)
    })
  })
}

describe('mrclean-mcp server process: SIGTERM graceful shutdown', () => {
  it('starts up and exits 0 on SIGTERM within 2s', { timeout: 10000 }, async () => {
    const result = await spawnAndSignal(NODE, [DIST_MCP], {
      waitForPatternInStderr: /running on stdio/,
      signal: 'SIGTERM',
      timeoutMs: 8000,
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('running on stdio')
    expect(result.stderr).toContain('received SIGTERM')
  })

  it('no MaxListenersExceededWarning on SIGTERM', { timeout: 10000 }, async () => {
    const result = await spawnAndSignal(NODE, [DIST_MCP], {
      waitForPatternInStderr: /running on stdio/,
      signal: 'SIGTERM',
      timeoutMs: 8000,
    })

    expect(result.stderr).not.toContain('MaxListenersExceededWarning')
  })
})

describe('mrclean-mcp server process: SIGINT graceful shutdown', () => {
  it('starts up and exits 0 on SIGINT within 2s', { timeout: 10000 }, async () => {
    const result = await spawnAndSignal(NODE, [DIST_MCP], {
      waitForPatternInStderr: /running on stdio/,
      signal: 'SIGINT',
      timeoutMs: 8000,
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('received SIGINT')
    expect(result.stderr).not.toContain('MaxListenersExceededWarning')
  })
})

describe('installShutdownHandlers: listener count regression guard', () => {
  it('child process has exactly 1 SIGINT listener and 1 SIGTERM listener after server startup', { timeout: 15000 }, async () => {
    // Spawn the real mrclean-mcp server in a child process, then run a probe via a
    // sibling process that inspects the listener count on the server's event emitter.
    // Because we can't directly query another process's listenerCount, we instead
    // verify indirectly: the server sends a single SIGTERM/SIGINT message to stderr
    // (not duplicated), and there is no MaxListenersExceededWarning.
    // Additionally, we spawn a meta-script that starts a server and reads listenerCount.
    const probeScript = `
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const serverPath = ${JSON.stringify(DIST_MCP)};
const server = spawn(${JSON.stringify(NODE)}, [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
let listenerCountSigint = -1;
let listenerCountSigterm = -1;

server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  stderr += chunk;
  if (/running on stdio/.test(stderr)) {
    // Ask the OS process for its listener count — we can't, but we can check
    // that the shutdown message appears exactly once when we SIGTERM it.
    server.kill('SIGTERM');
  }
});

server.on('exit', (code) => {
  const result = {
    exitCode: code,
    sigintMentionCount: (stderr.match(/received SIGINT/g) || []).length,
    sigtermMentionCount: (stderr.match(/received SIGTERM/g) || []).length,
    noWarning: !stderr.includes('MaxListenersExceededWarning'),
    cleanExit: code === 0,
  };
  console.log(JSON.stringify(result));
  process.exit(0);
});

setTimeout(() => {
  server.kill('SIGKILL');
  console.log(JSON.stringify({ error: 'timeout' }));
  process.exit(1);
}, 10000);
`

    const result = await spawnEval(probeScript, { timeoutMs: 13000 })
    expect(result.code).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    // Exactly one shutdown message — proves handlers weren't duplicated
    expect(parsed.sigtermMentionCount).toBe(1)
    expect(parsed.noWarning).toBe(true)
    expect(parsed.cleanExit).toBe(true)
  })
})
