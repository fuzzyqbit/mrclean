#!/bin/sh
# e4-large-output-hook.sh — E4 instrument (Plan 08-04, REVMODE-10).
#
# PostToolUse fixture: emits a ~15K-char updatedToolOutput with
# E4_HEAD_MARKER at the start and E4_TAIL_MARKER at the end. Answers whether
# the documented 10K-char hook-output cap (docs list additionalContext,
# systemMessage, plain stdout; updatedToolOutput is UNLISTED) also binds
# updatedToolOutput — signal: does the TAIL marker survive into the
# model-facing tool_result?
#
# MARKER STRINGS ONLY — never real secret shapes (leak-grep discipline).

# Consume the stdin payload.
cat > /dev/null

if [ -n "$HOOK_LOG" ]; then
  echo "e4-large-output-hook-fired" >> "$HOOK_LOG"
fi

node -e '
  const filler = "x".repeat(15000)
  const body = "E4_HEAD_MARKER " + filler + " E4_TAIL_MARKER"
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: body },
    }),
  )
'
exit 0
