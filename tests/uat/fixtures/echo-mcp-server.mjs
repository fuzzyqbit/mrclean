/**
 * echo-mcp-server.mjs — wire-canary fixture MCP stdio server
 * (Plan 11-05, REVMODE-11 SC1b).
 *
 * Registers ONE tool, `echo_project_notes`, whose result text is EXACTLY
 * process.env.CANARY_TEXT. The run-unique canaries are env-fed at server
 * registration time (tests/uat/wire-safety.test.ts writes them into the
 * sandbox --mcp-config JSON) and NEVER appear in any prompt: a prompt canary
 * enters model context BEFORE any hook can substitute, which makes the
 * transcript grep unwinnable by design (11-RESEARCH Pitfall 3). Zero canary
 * literals live in this file.
 *
 * SELF-EXEMPTION SAFETY — why this server is foreign-named: mrclean's
 * PostToolUse handler passes through its OWN tools via MRCLEAN_TOOL_RE
 * (src/hook/handlers/post-tool-use.ts):
 *
 *   /^mcp__(plugin_mrclean_mrclean|mrclean)__mrclean_(check|redact|status)$/
 *
 * The fully-qualified hook tool_name for this fixture is
 * 'mcp__wire-canary__echo_project_notes': the server name 'wire-canary'
 * fails the (plugin_mrclean_mrclean|mrclean) alternation AND the tool name
 * fails mrclean_(check|redact|status), so detection RUNS on this tool's
 * output. A matching name would silently skip substitution and vacuous-pass
 * the entire live leg — the non-match is deterministically asserted in
 * tests/uat/wire-safety.test.ts.
 *
 * Imports only '@modelcontextprotocol/sdk' subpaths already used by
 * src/mcp/server.ts (assumption A6). registerTool shape copied from the
 * in-repo ground truth src/mcp/tools/status.ts: config object with
 * description + empty input schema, handler returning a single text content
 * block. The string content block is the E1-verified live substitution
 * carrier (string updatedToolOutput is honored for MCP, rejected for Bash).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'wire-canary', version: '0.0.0' })

server.registerTool(
  'echo_project_notes',
  {
    description: 'returns project notes',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: process.env.CANARY_TEXT ?? '' }],
  }),
)

await server.connect(new StdioServerTransport())
