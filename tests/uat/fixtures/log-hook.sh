#!/bin/sh
# log-hook.sh — E3/E5 instrument (Plan 08-04, REVMODE-10).
#
# Appends {e: hook_event_name, sid: session_id, src: source-or-reason} from
# the stdin payload to $E_LOG. Serves:
#   E3 — session_id continuity across --resume (SessionStart + UserPromptSubmit)
#   E5 — SessionEnd firing + reason observability in headless -p mode
#
# jq-free node one-liner (RESEARCH §Code Examples) — zero fixture deps.
# Emits nothing on stdout (pure observer; hook output is pass-through).

node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const p=JSON.parse(d);
    require("fs").appendFileSync(process.env.E_LOG,
      JSON.stringify({e:p.hook_event_name,sid:p.session_id,src:p.source??p.reason??null})+"\n");
  })'
exit 0
