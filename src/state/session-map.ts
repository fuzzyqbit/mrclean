/**
 * Session map schema + contracts for mrclean reversible mode (REVMODE-06).
 *
 * Phase 9 (09-02) — schema + contracts for the encrypted session map;
 * map I/O lives in map-store.ts, transactions in index.ts.
 *
 * This module is PURE: node:crypto (createHmac, randomBytes) only — no fs,
 * no config input, no schema-validation deps (cold-path discipline; hand
 * guards follow the isRecord idiom from src/config/index.ts).
 *
 * THE STRUCTURAL SECRET FLOOR (D-11, write-time):
 * The restorable/never-restorable partition below is FROZEN CODE. No function
 * in this module accepts configuration that could widen the restorable set —
 * the "no config can widen" clause of D-11 is proven structurally by this
 * module having no config parameter anywhere. Secret-class entries lack an
 * `original` property at the type level (SecretMapEntry), the serializer
 * strips a hand-poisoned `original` at write time, and the parser drops it
 * at read time (defense in depth; Phase 10 adds the restore-side gate).
 *
 * To change the partition in a future phase: revise the D-11 decision first,
 * then update RESTORABLE_TYPES here and the counts in
 * tests/state/secret-floor.test.ts (the vocabulary-sync test fails loudly on
 * any unclassified TYPE_VOCABULARY addition until you do).
 */

import { createHmac, randomBytes } from 'node:crypto'
import { TYPE_VOCABULARY } from '../detect/type-map.js'

// ---------------------------------------------------------------------------
// Partition constants (D-11 / RESEARCH Pattern 5)
// ---------------------------------------------------------------------------

/**
 * The ONLY TYPEs whose original value may be persisted in a session map.
 *
 * Everything NOT in this list is secret-class — INCLUDING any unknown future
 * TYPE (fail-toward-privacy, mirroring getTypeForRuleId's `?? 'SECRET'`
 * fallback in src/detect/type-map.ts).
 *
 * Existing entries MUST NOT be added to without revising decision D-11.
 */
export const RESTORABLE_TYPES: readonly string[] = Object.freeze([
  'WORD',
  'PII_EMAIL',
  'PII_PHONE',
  'PII_IP',
  'PII_PERSON',
  'PII_ORG',
  'PII_LOC',
] as const)

const RESTORABLE_SET: ReadonlySet<string> = new Set(RESTORABLE_TYPES)

/**
 * The never-restorable complement, derived from the frozen 25-entry
 * TYPE_VOCABULARY: the 13 named secret TYPEs + SECRET, ENV, ENTROPY,
 * PII_SSN, PII_CREDIT_CARD (18 total). Unknown TYPEs are secret-class too —
 * membership here is informational; isRestorableType is the authority.
 */
export const NEVER_RESTORABLE_TYPES: readonly string[] = Object.freeze(
  TYPE_VOCABULARY.filter((type) => !RESTORABLE_SET.has(type)),
)

/**
 * True only for the frozen 7 restorable TYPEs. Any other string — including
 * TYPEs added to the vocabulary later but not classified here — is
 * secret-class (fail-toward-privacy).
 */
export function isRestorableType(type: string): boolean {
  return RESTORABLE_SET.has(type)
}

// ---------------------------------------------------------------------------
// Entry + map shapes
// ---------------------------------------------------------------------------

/**
 * A persisted entry for a secret-class TYPE. Structurally has NO `original`
 * property — absent, not null/empty (SC3). The entry's record key in
 * SessionMapV1.entries is hmacAddress(hashSalt, original), which is what
 * makes cross-process stable allocation possible without storing the value.
 */
export interface SecretMapEntry {
  placeholder: string
  type: string
  counter: number
}

/** A persisted entry for one of the 7 restorable TYPEs — carries `original`. */
export interface RestorableMapEntry {
  placeholder: string
  type: string
  counter: number
  original: string
}

export type SessionMapEntry = SecretMapEntry | RestorableMapEntry

/**
 * Plaintext schema of the session map (the JSON INSIDE the encrypted
 * envelope — map-store.ts owns the ciphertext framing).
 *
 * `entries` is keyed by hmacAddress(hashSalt, original) — see Pattern 3.
 */
export interface SessionMapV1 {
  version: 1
  sessionId: string
  /** 8 lowercase hex chars — per-session CSPRNG v2 token tag (D-10). */
  nonce8: string
  /** 64 lowercase hex chars — 32 random bytes keying HMAC addressing. */
  hashSalt: string
  /** Authoritative NNN counter (grows only). */
  counter: number
  entries: Record<string, SessionMapEntry>
}

const NONCE_BYTES = 4 // → 8 lowercase hex chars (v2 token session tag, D-10)
const SALT_BYTES = 32 // → 64 lowercase hex chars (HMAC content-address key)

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Fresh empty map with CSPRNG nonce8 + hashSalt (D-04/D-10 randomness). */
export function createEmptySessionMap(sessionId: string): SessionMapV1 {
  return {
    version: 1,
    sessionId,
    nonce8: randomBytes(NONCE_BYTES).toString('hex'),
    hashSalt: randomBytes(SALT_BYTES).toString('hex'),
    counter: 0,
    entries: {},
  }
}

/**
 * Construct a map entry, applying the secret floor at construction time.
 *
 * The `original` argument is accepted for every TYPE (callers always hold it
 * in memory at allocation time) but is only ATTACHED for the 7 restorable
 * TYPEs. For everything else the returned object never carries the property.
 */
export function makeMapEntry(
  type: string,
  placeholder: string,
  counter: number,
  original: string,
): SessionMapEntry {
  if (isRestorableType(type)) {
    return { placeholder, type, counter, original }
  }
  // Fail-toward-privacy: any TYPE outside the frozen restorable 7 — including
  // unknown future TYPEs — is secret-class; the returned object structurally
  // LACKS `original` (property absent, never null/empty — REVMODE-06 / D-11).
  return { placeholder, type, counter }
}

// ---------------------------------------------------------------------------
// Serialize / parse (write-time floor + total hand guards)
// ---------------------------------------------------------------------------

/**
 * Rebuild an entry field-by-field for persistence. Secret-class entries are
 * reconstructed WITHOUT `original` even if a caller hand-poisoned one past
 * the type system — defense in depth behind the SecretMapEntry type floor.
 */
function toPersistableEntry(entry: SessionMapEntry): SessionMapEntry {
  if (isRestorableType(entry.type) && 'original' in entry) {
    return {
      placeholder: entry.placeholder,
      type: entry.type,
      counter: entry.counter,
      original: entry.original,
    }
  }
  return { placeholder: entry.placeholder, type: entry.type, counter: entry.counter }
}

/**
 * Serialize a map to the plaintext JSON that map-store.ts encrypts.
 *
 * Builds a NEW entries record (input never mutated); every secret-class
 * entry is emitted `{placeholder, type, counter}` only (D-11 write-time
 * floor — the second layer after the SecretMapEntry type shape).
 */
export function serializeSessionMap(map: SessionMapV1): string {
  const entries = Object.fromEntries(
    Object.entries(map.entries).map(([key, entry]) => [key, toPersistableEntry(entry)]),
  )
  return JSON.stringify({ ...map, entries })
}

/** Hand guard: plain object (not null, not array) — config/index.ts idiom. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Hand guard: integer counter values (NNN counters never go negative). */
function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/**
 * Validate and rebuild one raw entry. Returns null on any shape failure.
 *
 * Read-side floor hardening: a secret-class entry carrying `original` in
 * stored JSON (poisoned disk state) parses successfully but the property is
 * DROPPED — secret originals never re-enter memory from disk. (Phase 10 adds
 * the restore-side policy gate on top.)
 */
function parseMapEntry(raw: unknown): SessionMapEntry | null {
  if (!isRecord(raw)) return null
  const placeholder = raw['placeholder']
  const type = raw['type']
  const counter = raw['counter']
  if (typeof placeholder !== 'string') return null
  if (typeof type !== 'string') return null
  if (!isNonNegativeInteger(counter)) return null
  if (isRestorableType(type) && 'original' in raw) {
    if (typeof raw['original'] !== 'string') return null
    return { placeholder, type, counter, original: raw['original'] }
  }
  return { placeholder, type, counter }
}

/**
 * Parse plaintext JSON into a SessionMapV1. Hand guards only — returns null
 * on ANY shape failure (non-JSON, wrong version, missing/wrong-typed fields,
 * malformed entries). Callers treat null as map-absent (fail-safe; Pitfall 6
 * total-read-path policy lives in the 09-05 facade).
 */
export function parseSessionMap(json: string): SessionMapV1 | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (raw['version'] !== 1) return null
  const sessionId = raw['sessionId']
  const nonce8 = raw['nonce8']
  const hashSalt = raw['hashSalt']
  const counter = raw['counter']
  const entriesRaw = raw['entries']
  if (typeof sessionId !== 'string') return null
  if (typeof nonce8 !== 'string') return null
  if (typeof hashSalt !== 'string') return null
  if (!isNonNegativeInteger(counter)) return null
  if (!isRecord(entriesRaw)) return null

  const entries: Record<string, SessionMapEntry> = {}
  for (const [key, value] of Object.entries(entriesRaw)) {
    const entry = parseMapEntry(value)
    if (entry === null) return null
    entries[key] = entry
  }
  return { version: 1, sessionId, nonce8, hashSalt, counter, entries }
}

// ---------------------------------------------------------------------------
// Content addressing (Pattern 3)
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 content address for an original value, keyed by the map's
 * per-session random salt (hex-decoded to its 32 raw bytes).
 *
 * Why HMAC over plain sha256: secret-class entries persist hash-without-
 * original; an unsalted sha256 would let anyone holding a decrypted map
 * dictionary-confirm guessed secrets. The per-session salt (stored only
 * inside the encrypted envelope) also kills cross-session hash correlation.
 *
 * ACCEPTED RESIDUAL (T-09-02-05): an HMAC-SHA256 collision (~2^-128 per
 * pair) would make two originals share one placeholder, producing a cosmetic
 * wrong-value restore in Phase 10 — negligible, documented per Pattern 3.
 */
export function hmacAddress(saltHex: string, value: string): string {
  return createHmac('sha256', Buffer.from(saltHex, 'hex')).update(value, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// v2 token format (D-10 / Pattern 4)
// ---------------------------------------------------------------------------

const V2_COUNTER_MAX = 999
const V2_COUNTER_PAD = 3

/**
 * Format a v2 session-tagged placeholder token.
 *
 * counter <= 999 → `<MRCLEAN:TYPE:NNN:nonce8>` (3-digit zero-pad);
 * counter  > 999 → `<MRCLEAN:TYPE:OVF:nonce8>` (same shared-token OVF
 * semantics as v1 — multiple originals of one TYPE may share an OVF token).
 *
 * The per-session CSPRNG nonce8 kills planted-token enumeration (D-10):
 * a remote party cannot fabricate a token that restores in someone else's
 * session without knowing the session's nonce.
 */
export function formatV2Token(type: string, counter: number, nonce8: string): string {
  if (counter > V2_COUNTER_MAX) {
    return `<MRCLEAN:${type}:OVF:${nonce8}>`
  }
  return `<MRCLEAN:${type}:${String(counter).padStart(V2_COUNTER_PAD, '0')}:${nonce8}>`
}

/** Matcher for v2 tokens: `<MRCLEAN:TYPE:NNN|OVF:nonce8>`. */
export const V2_TOKEN_RE = /^<MRCLEAN:([A-Z0-9_]+):(\d{3}|OVF):([a-f0-9]{8})>$/

// ---------------------------------------------------------------------------
// Session-id allowlist (Pitfall 5)
// ---------------------------------------------------------------------------

/**
 * Strict UUID allowlist for hook-supplied session ids. sid is interpolated
 * into key/map file paths downstream — this regex is the ONLY gate between a
 * hostile sid (`../../../etc/foo`) and path construction. Never sanitize by
 * transform (collisions); non-matching sids mean reversible-unavailable.
 * Synthetic ids like 'mcp-server' fail structurally (MCP-lane fence).
 */
export const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidSessionId(sid: string): boolean {
  return SESSION_ID_RE.test(sid)
}

// ---------------------------------------------------------------------------
// Downstream contracts (type-only — consumed by 09-04/09-05)
// ---------------------------------------------------------------------------

/**
 * Hydration payload handed to PlaceholderManager (09-04, type-only import)
 * by the state facade (09-05). Closures keep the manager free of state
 * runtime imports (cold-path fence — Pitfall 7).
 */
export interface ReversibleHydration {
  nonce8: string
  /** Manager must allocate NNN strictly above this floor. */
  counterFloor: number
  /** Known allocations keyed by hmacAddress(hashSalt, original). */
  entriesByHmac: ReadonlyMap<string, { placeholder: string; type: string }>
  hmacOf: (value: string) => string
  formatToken: (type: string, counter: number) => string
}

/** An allocation made during detection, awaiting the locked persist step. */
export interface PendingAllocation {
  /** Raw original — memory only, never logged. */
  value: string
  type: string
  provisionalPlaceholder: string
}

/** Reconcile outcome: a provisional placeholder renamed to the store winner. */
export interface PlaceholderRename {
  from: string
  to: string
}
