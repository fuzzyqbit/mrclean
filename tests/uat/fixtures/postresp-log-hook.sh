#!/bin/sh
# postresp-log-hook.sh — per-tool tool_response shape survey instrument
# (Plan 11-05, REVMODE-11; re-homed STATE.md Phase 10 todo).
#
# Appends ONE JSON line per PostToolUse event to $E_LOG:
#   {tool_name, t: typeof tool_response, raw: JSON.stringify(tool_response)
#    truncated to 2000 chars}
#
# Parallel observer (assumption A5): registered ALONGSIDE other PostToolUse
# hooks — hooks on one event run in parallel and each receives the payload,
# so this sees the RAW pre-substitution tool_response even when mrclean's
# real hook is also registered. Emits NOTHING on stdout (pure observer; hook
# output is pass-through) and exits 0 unconditionally.
#
# jq-free node one-liner (log-hook.sh sibling) — zero fixture deps. The
# String(...) wrap keeps the line total when tool_response is undefined
# (JSON.stringify(undefined) === undefined has no .slice).

node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d);
    const r=p.tool_response;
    require("fs").appendFileSync(process.env.E_LOG,
      JSON.stringify({tool_name:p.tool_name,t:typeof r,raw:String(JSON.stringify(r)).slice(0,2000)})+"\n");
  })'
exit 0
