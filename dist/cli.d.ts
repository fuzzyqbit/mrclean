#!/usr/bin/env node
import { Command } from 'commander';

/**
 * mrclean CLI entrypoint.
 *
 * Commander root with registered (stub) subcommands:
 *   install   → src/install/index.ts → runInstall(opts)   (Plan 02)
 *   uninstall → src/install/index.ts → runUninstall(opts) (Plan 02)
 *   hook      → src/hook/index.ts    → runHook()          (Plan 03)
 *   doctor    → src/doctor/index.ts  → runDoctor(opts)    (Plan 05)
 *
 * IMPORTANT: commander is pinned to ^13.x (CLAUDE.md LOCK).
 * The .command().option().action().parseAsync() surface is identical in 13 and 14.
 *
 * The entrypoint guard (import.meta.url check) prevents parseAsync from running
 * when this module is imported in tests.
 */

declare const program: Command;

export { program };
