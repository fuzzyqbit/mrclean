---
description: Initialize mrclean in this project — create .mrclean/ with a config.toml stub and a words.txt seed
argument-hint: (no arguments)
allowed-tools: Bash(npx mrclean-claude init), Bash(mrclean init)
disable-model-invocation: true
---

# mrclean: initialize project

Scaffold the project-local mrclean environment by running the CLI in the project root:

```
npx mrclean-claude init
```

(The published npm package is `mrclean-claude`; its bin is `mrclean`. Use
`npx mrclean-claude init` — a bare `npx mrclean` resolves to an unrelated package.
If installed globally via `npm i -g mrclean-claude`, `mrclean init` also works.)

This is project-only — it does **not** touch global `~/.claude` wiring (that is what
`npx mrclean-claude install` does). It creates, without clobbering anything that already exists:

- `.mrclean/config.toml` — allowlist / entropy / per-rule overrides (commented stub)
- `.mrclean/words.txt` — your dirty-word list (commented seed)
- a `.mrclean/` entry in the project-root `.gitignore`

After it runs, tell the user:

1. Where `.mrclean/words.txt` is, and that proprietary terms go there — one per line,
   optional `term|action` (`block` default, `warn`, or `audit`).
2. That `.mrclean/` is gitignored, so those terms never get committed.
3. That edits hot-reload at the next Claude Code SessionStart — no restart needed.

Do not invent config keys. Only the keys shown in the generated `config.toml` stub are
read by mrclean. Custom redaction terms belong in `words.txt`, not in `config.toml`.
