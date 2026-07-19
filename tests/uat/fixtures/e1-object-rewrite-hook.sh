#!/bin/sh
# e1-object-rewrite-hook.sh — E1 shape-validation instrument (Plan 08-04 Task 3, REVMODE-10).
#
# PostToolUse fixture: emits the OBJECT-shaped updatedToolOutput
# ({stdout, stderr, interrupted, isImage}) — the form Claude Code 2.1.209
# HONORS for built-in Bash. Companion to e1-rewrite-hook.sh, whose STRING
# payload is REJECTED by per-tool output-shape validation (zod invalid_type:
# "expected object, received string") with a hook warning; original output
# is then used. Together the pair isolates the shape-validation discovery
# behind the "ignored for Bash" verdicts (anthropics/claude-code#68951).
#
# MARKER STRINGS ONLY — never real secret shapes (leak-grep discipline).
#
# Side effects: appends a fired-marker line to $HOOK_LOG when set, so the
# harness can hard-assert "hook fired" (harness integrity) independently of
# the recorded contract verdict.

# Consume the stdin payload (hook contract: payload arrives on stdin).
cat > /dev/null

if [ -n "$HOOK_LOG" ]; then
  echo "e1-object-hook-fired" >> "$HOOK_LOG"
fi

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"REWRITTEN_E1_MARKER_x9k2","stderr":"","interrupted":false,"isImage":false}}}'
exit 0
