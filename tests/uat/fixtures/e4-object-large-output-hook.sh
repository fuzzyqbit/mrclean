#!/bin/sh
# e4-object-large-output-hook.sh — E4 rerun instrument (Plan 08-08, gap 2).
#
# PostToolUse fixture: emits a ~15K-char updatedToolOutput in the OBJECT
# shape ({stdout, stderr, interrupted, isImage}) per
# e1-object-rewrite-hook.sh — the form Claude Code 2.1.209 HONORS for
# built-in Bash (string form is rejected by per-tool output-shape
# validation). E4_HEAD_MARKER opens and E4_TAIL_MARKER closes the stdout
# body, so the harness can observe whether the documented 10K-char
# hook-output cap (updatedToolOutput is UNLISTED in the docs) truncates
# the model-facing tool_result.
#
# MARKER STRINGS ONLY — never real secret shapes (leak-grep discipline).

# Consume the stdin payload.
cat > /dev/null

if [ -n "$HOOK_LOG" ]; then
  echo "e4-object-large-output-hook-fired" >> "$HOOK_LOG"
fi

node -e '
  const filler = "x".repeat(15000)
  const body = "E4_HEAD_MARKER " + filler + " E4_TAIL_MARKER"
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: { stdout: body, stderr: "", interrupted: false, isImage: false },
      },
    }),
  )
'
exit 0
