#!/bin/sh
# e1-rewrite-hook.sh — E1 instrument (Plan 08-04, REVMODE-10).
#
# PostToolUse fixture: unconditionally rewrites the tool output to a MARKER
# string via hookSpecificOutput.updatedToolOutput. Isolates the contract
# question ("is updatedToolOutput honored, per tool?") from mrclean's
# detection stack — same repro method as anthropics/claude-code#68951.
#
# MARKER STRINGS ONLY — never real secret shapes (leak-grep discipline).
#
# Side effects: appends a fired-marker line to $HOOK_LOG when set, so the
# harness can hard-assert "hook fired" (harness integrity) independently of
# the recorded contract verdict.

# Consume the stdin payload (hook contract: payload arrives on stdin).
cat > /dev/null

if [ -n "$HOOK_LOG" ]; then
  echo "e1-rewrite-hook-fired" >> "$HOOK_LOG"
fi

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":"REWRITTEN_E1_MARKER_x9k2"}}'
exit 0
