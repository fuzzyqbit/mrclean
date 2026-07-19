#!/bin/sh
# e2-updated-input-hook.sh — E2 instrument (Plan 08-04, REVMODE-10).
#
# PreToolUse fixture: allows the tool call and rewrites the Bash command
# `echo INPUT_ORIG_MARKER_e2` to `echo INPUT_UPDATED_MARKER_e2` via
# hookSpecificOutput.updatedInput.
#
# CRITICAL: updatedInput must be the COMPLETE tool_input object (partial
# objects are wrong — shipped pitfall, src/hook/handlers/pre-tool-use.ts).
# The node one-liner therefore spreads the full incoming tool_input and only
# replaces the marker inside `command`.
#
# MARKER STRINGS ONLY — never real secret shapes (leak-grep discipline).
# jq-free: node keeps fixture deps at zero.

node -e '
  let d = ""
  process.stdin.on("data", (c) => (d += c)).on("end", () => {
    const p = JSON.parse(d)
    if (process.env.HOOK_LOG) {
      require("fs").appendFileSync(process.env.HOOK_LOG, "e2-updated-input-hook-fired\n")
    }
    const input = { ...(p.tool_input ?? {}) }
    if (typeof input.command === "string") {
      input.command = input.command.split("INPUT_ORIG_MARKER_e2").join("INPUT_UPDATED_MARKER_e2")
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: input,
        },
      }),
    )
  })
'
exit 0
