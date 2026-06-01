/**
 * Spike 001 — empirical mrclean side.
 *
 * Drives the REAL shipped hook (dist/cli.js hook) with a UserPromptSubmit payload
 * per sample, parses the decision, and tabulates detection vs the doc-grounded
 * Presidio expectation. Presidio is NOT run live here (see README).
 *
 * Run:  node .planning/spikes/001-vs-presidio/run-mrclean.mjs
 *
 * Secrets are generated at runtime with a SEEDED PRNG (deterministic + reproducible)
 * so (a) no full secret literal lives in this file — mrclean's own PreToolUse hook
 * redacts high-entropy literals on write (it corrupted two earlier drafts this way —
 * see README), and (b) the values are realistic high-entropy and NOT the famous
 * allowlisted AWS example key, which scanners deliberately ignore.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const cli = join(repo, 'dist', 'cli.js')
const fixtureCwd = join(here, 'fixture')

// Self-seed the fixture words.txt. The repo .gitignore ignores all .mrclean/ dirs,
// so this fixture is NOT committed — recreate it on every run for reproducibility.
mkdirSync(join(fixtureCwd, '.mrclean'), { recursive: true })
writeFileSync(join(fixtureCwd, '.mrclean', 'words.txt'), 'project-bluebird\n')

function rng(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r = rng(1337)
const pick = (chars, n) => Array.from({ length: n }, () => chars[Math.floor(r() * chars.length)]).join('')
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const AL = '<MRCLEAN:ENTROPY:001>'
const HEX = '0123456789abcdef'
const B64 = '<MRCLEAN:ENTROPY:002>'

const SAMPLES = [
  { id: 'aws-access-key', category: 'secret', text: `deploy with AWS key ${'AKIA' + pick(UP, 16)} today`, presidio: 'none — no built-in recognizer' },
  { id: 'github-pat', category: 'secret', text: `token ${'ghp_' + pick(AL, 36)} works`, presidio: 'none — no built-in recognizer' },
  { id: 'private-key', category: 'secret', text: `-----BEGIN RSA PRIVATE KEY-----\n${pick(B64, 64)}\n${pick(B64, 64)}\n-----END RSA PRIVATE KEY-----`, presidio: 'none — no built-in recognizer' },
  { id: 'jwt', category: 'secret', text: `auth ${'eyJ' + pick(AL, 30)}.${'eyJ' + pick(AL, 40)}.${pick(AL, 43)} ok`, presidio: 'none — no built-in recognizer' },
  { id: 'high-entropy', category: 'secret', text: `value ${pick(HEX, 48)} here`, presidio: 'none — no entropy heuristic' },
  { id: 'db-url', category: 'secret', text: `DATABASE_URL=${'postgres://' + 'admin:' + pick(AL, 14) + '@db.internal:5432/prod'}`, presidio: 'URL only — would not isolate the credential' },
  { id: 'proprietary', category: 'proprietary', text: `${'project-' + 'bluebird'} ships to the customer next week`, presidio: 'none — no project-term concept' },
  { id: 'person-name', category: 'pii', text: 'My name is James Bond and I work here', presidio: 'PERSON (NER)' },
  { id: 'email', category: 'pii', text: 'reach me at john.doe@example.com anytime', presidio: 'EMAIL_ADDRESS (regex)' },
  { id: 'us-phone', category: 'pii', text: 'call me at 212-555-0173 tomorrow', presidio: 'PHONE_NUMBER (regex+context)' },
  { id: 'us-ssn', category: 'pii', text: 'my SSN is 123-45-6789 for the form', presidio: 'US_SSN (regex+context)' },
  { id: 'credit-card', category: 'pii', text: `pay with card ${'4111 ' + '1111 1111 1111'} now`, presidio: 'CREDIT_CARD (regex+Luhn)' },
  { id: 'ip-address', category: 'pii', text: 'the server lives at 192.168.1.42 internally', presidio: 'IP_ADDRESS (regex)' },
]

function runHook(prompt) {
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'spike-001', cwd: fixtureCwd, prompt })
  const res = spawnSync(process.execPath, [cli, 'hook'], { input: payload, encoding: 'utf8' })
  try {
    return JSON.parse(res.stdout || '{}')
  } catch {
    return {}
  }
}

function interpret(o) {
  if (o && o.decision === 'block') {
    const m = /\[mrclean\]\s+(\S+)\s+\((\w+)\)/.exec(o.reason || '')
    return { detected: true, action: 'BLOCK', rule: m ? m[1] : '?', severity: m ? m[2] : '?' }
  }
  const ac = (o && o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || ''
  if (/\d+\s+detection/.test(ac)) return { detected: true, action: 'warn', rule: '(medium/low)', severity: 'MED/LOW' }
  return { detected: false, action: 'allow', rule: '-', severity: '-' }
}

const results = []
console.log('cat        | sample              | mrclean                       | presidio (doc, not run live)')
console.log('-----------|---------------------|-------------------------------|-----------------------------')
for (const s of SAMPLES) {
  const v = interpret(runHook(s.text))
  results.push({ id: s.id, category: s.category, mrclean: v, presidio_expected: s.presidio })
  const flag = v.detected ? 'DET ' : 'miss'
  console.log(`${s.category.padEnd(10)} | ${s.id.padEnd(19)} | ${flag} ${v.action.padEnd(5)} ${(v.rule || '').slice(0, 14).padEnd(14)} | ${s.presidio}`)
}
writeFileSync(join(here, 'results.json'), JSON.stringify(results, null, 2))
const det = results.filter((x) => x.mrclean.detected).length
console.log(`\nmrclean detected ${det}/${results.length}. wrote results.json`)
