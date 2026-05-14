/**
 * Doctor subcommand handler — canary round-trip, config check, version report.
 *
 * Plan 01 stub — body replaced by Plan 05.
 */

export interface DoctorOptions {
  /** reserved for Plan 05 */
  verbose?: boolean
}

/**
 * Run the doctor: verify hook entries, MCP registration, absolute paths,
 * canary round-trip, and Claude Code version compatibility.
 *
 * Plan 05 replaces this stub with the real implementation.
 * Exit code semantics are documented in RESEARCH.md §4.4.
 */
export async function runDoctor(opts: DoctorOptions): Promise<void> {
  process.stderr.write('doctor: not implemented in Plan 01\n')
}
