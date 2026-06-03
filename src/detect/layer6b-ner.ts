/**
 * Layer 6b: NER-based PII detection engine (MCP-only).
 *
 * Runs the warm `token-classification` pipeline (via the lazy singleton), aggregates BERT
 * WordPiece subword tokens into entity spans with char offsets and a conservative per-entity
 * score, applies the `min_score` floor (config field `pii.ner.confidence`, D-07/D-08), maps
 * model labels to canonical PERSON/ORG/LOC (D-09), and emits `Finding[]` with source `'pii-ner'`
 * and an explicit `action: 'substitute'` (D-02 — NER never blocks).
 *
 * Mirrors the sibling Layer 6a engine (src/detect/layer6a-pii.ts): same imports, the same
 * `overlapsCovered` skip protocol, the same Finding builder + allowlist + sort tail. The
 * differences are: source `'pii-ner'`, explicit `'substitute'` action, async pipeline invocation,
 * and the two fail-closed boundaries.
 *
 * FAIL-CLOSED FOR NER ONLY (NER-03 / D-05): two try/catch boundaries — model LOAD (getNerPipeline)
 * and INFERENCE (pipe(text)). Either throw returns `{ findings: [], status: 'unavailable' }` and
 * NEVER re-throws. The catch must live HERE, not in the MCP `supervisedToolCall` wrapper — that
 * would convert a NER error into an `isError` for the WHOLE tool, wrongly failing the secret gate.
 *
 * NO-PII-LEAK (RESEARCH Pitfall 5): the fail-closed returns carry NO matched text; a finding's
 * `value` flows only into redactedHash/fingerprint, never into a log/error/status string.
 *
 * Wave-0 (Plan 06-01 Task 0) verified the pipeline returns per-token `{ entity, score, index, word }`
 * with NO char offsets for Xenova/bert-base-NER. `aggregateBio` therefore reconstructs char spans
 * from the `word` surface form via a forward-scanning cursor (Route B), and also honors explicit
 * token `start`/`end` when a model/pipeline does expose them.
 *
 * Plan 06-01 — implements NER-01 (engine), NER-02 (min_score floor + entities), NER-03 (fail-closed).
 */

import type { Finding } from './findings.js'
import { redactedHash, fingerprint } from './findings.js'
import { isAllowlisted } from './allowlist.js'
import { getNerPipeline } from '../model/pipeline-singleton.js'
import { mapModelLabel } from './ner-entities.js'
import type { MrcleanPiiNerConfig, MrcleanConfig } from '../shared/types.js'

/** Lifecycle status surfaced to the MCP tools (D-03/D-05). */
export type NerStatus = 'ready' | 'unavailable' | 'loading' | 'disabled'

/**
 * Raw per-token output from the token-classification pipeline.
 * `start`/`end` are OPTIONAL — bert-base-NER does not emit them (Wave-0 finding).
 */
interface RawToken {
  entity: string
  score: number
  index: number
  word: string
  start?: number
  end?: number
}

/** An aggregated entity span: BIO run stitched into one region with a conservative score. */
interface EntitySpan {
  label: string // raw model label of the run's first token (e.g. 'B-PER')
  start: number
  end: number
  score: number // MIN of the run's subword scores
}

// ---------------------------------------------------------------------------
// Span overlap helper (mirrors layer6a-pii.ts overlapsCovered)
// ---------------------------------------------------------------------------

function overlapsCovered(
  candidateStart: number,
  candidateEnd: number,
  covered: readonly { start: number; end: number }[],
): boolean {
  for (const span of covered) {
    if (candidateStart < span.end && span.start < candidateEnd) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// BIO aggregation
// ---------------------------------------------------------------------------

/** Strip the WordPiece subword marker `##` from a token's surface form. */
function stripWordPiece(word: string): string {
  return word.startsWith('##') ? word.slice(2) : word
}

/** Bare entity tag of a BIO label: 'B-PER' → 'PER', 'I-ORG' → 'ORG', 'O' → 'O'. */
function bioTag(label: string): string {
  if (label.startsWith('B-') || label.startsWith('I-')) return label.slice(2)
  return label
}

/**
 * Locate the char span of a token's surface form in `text`, starting at/after `cursor`.
 *
 * Honors explicit `tok.start`/`tok.end` when present. Otherwise scans forward for the surface
 * form (with the `##` marker stripped) from `cursor` — this recovers char offsets for models
 * (like bert-base-NER) whose pipeline does not emit them. Returns `null` if not locatable.
 */
function locateToken(
  tok: RawToken,
  text: string,
  cursor: number,
): { start: number; end: number } | null {
  if (typeof tok.start === 'number' && typeof tok.end === 'number') {
    return { start: tok.start, end: tok.end }
  }
  const surface = stripWordPiece(tok.word)
  if (surface.length === 0) return null
  const idx = text.indexOf(surface, cursor)
  if (idx === -1) return null
  return { start: idx, end: idx + surface.length }
}

/**
 * Aggregate consecutive same-entity BIO subwords into entity spans.
 *
 * A run begins at a token whose tag is a real entity (non-'O') and continues while subsequent
 * tokens share the same bare tag AND are `I-` continuations (or contiguous same-tag tokens). The
 * per-entity score is the MIN of the run's subword scores (conservative floor). Char offsets are
 * resolved via `locateToken` against a forward-only cursor so reconstruction never matches an
 * earlier occurrence of the same surface form.
 *
 * @param raw  - Raw per-token pipeline output.
 * @param text - The original source text (for char-offset reconstruction).
 * @returns      Aggregated entity spans in source order.
 */
function aggregateBio(raw: readonly RawToken[], text: string): EntitySpan[] {
  const spans: EntitySpan[] = []
  let cursor = 0

  let current: EntitySpan | null = null
  let currentTag = ''

  const flush = (): void => {
    if (current) {
      spans.push(current)
      current = null
      currentTag = ''
    }
  }

  for (const tok of raw) {
    const tag = bioTag(tok.entity)

    // 'O' (outside) or empty tag ends any open run.
    if (tag === 'O' || tag === '') {
      flush()
      continue
    }

    const loc = locateToken(tok, text, cursor)
    if (!loc) {
      // Cannot place this token — end the run defensively (avoid mis-spanning).
      flush()
      continue
    }
    cursor = loc.end

    const isBegin = tok.entity.startsWith('B-')
    const sameRun = current !== null && tag === currentTag && !isBegin

    if (sameRun && current) {
      // Extend the open run; tighten the score to the MIN subword score.
      current.end = loc.end
      current.score = Math.min(current.score, tok.score)
    } else {
      // Start a new run (B- token, or a tag change, or an orphan I- token).
      flush()
      current = { label: tok.entity, start: loc.start, end: loc.end, score: tok.score }
      currentTag = tag
    }
  }

  flush()
  return spans
}

// ---------------------------------------------------------------------------
// runLayer6bNer — L6b NER engine entry point
// ---------------------------------------------------------------------------

/**
 * Run Layer 6b NER detection against `text`.
 *
 * Called ONLY from the orchestrator's MCP-gated L6b branch (Plan 06-02). The hook path never
 * reaches this function, keeping `@huggingface/transformers` off the cold path.
 *
 * @param text         - The raw text to scan.
 * @param ner          - The `pii.ner` sub-config (model, dtype, entities, confidence floor).
 * @param config       - Full MrcleanConfig — required for the 5-axis `isAllowlisted` check.
 * @param coveredSpans - Spans already claimed by earlier layers; overlapping candidates are skipped.
 * @returns              `{ findings, status }` — `status` is 'ready' on success, 'unavailable' on
 *                       any model-load or inference failure (fail-closed; never throws).
 */
export async function runLayer6bNer(
  text: string,
  ner: MrcleanPiiNerConfig,
  config: MrcleanConfig,
  coveredSpans: readonly { start: number; end: number }[] = [],
): Promise<{ findings: Finding[]; status: NerStatus }> {
  // Fail-closed boundary 1: model LOAD (NER-03). Never re-throw.
  let pipe
  try {
    pipe = await getNerPipeline(ner)
  } catch {
    return { findings: [], status: 'unavailable' }
  }

  // Fail-closed boundary 2: INFERENCE (NER-03). Never re-throw.
  let raw: RawToken[]
  try {
    raw = (await pipe(text)) as RawToken[]
  } catch {
    return { findings: [], status: 'unavailable' }
  }

  const spans = aggregateBio(raw, text)
  const findings: Finding[] = []

  for (const s of spans) {
    // D-07/D-08: drop spans below the confidence floor (field is `confidence`, == CONTEXT min_score).
    if (s.score < ner.confidence) continue

    const canonical = mapModelLabel(ner.model, s.label)
    // D-09: skip non-entity labels and entities toggled off via ner.entities.
    if (!canonical || !ner.entities.includes(canonical)) continue

    // Skip spans claimed by earlier (higher-precedence) layers (same protocol as L6a).
    if (overlapsCovered(s.start, s.end, coveredSpans)) continue

    const value = text.slice(s.start, s.end)
    if (value.length === 0) continue

    const candidate: Finding = {
      ruleId: `pii:${canonical}`,
      severity: 'MEDIUM', // MEDIUM → substitute; explicit action below makes it unambiguous (D-02).
      span: { start: s.start, end: s.end },
      value,
      redactedHash: redactedHash(value),
      fingerprint: fingerprint(`pii:${canonical}`, value),
      source: 'pii-ner',
      action: 'substitute', // explicit — NER never blocks (D-02); do NOT rely on severity default.
    }

    // 5-axis allowlist (shared with L1–L6a).
    if (isAllowlisted(candidate, config)) continue

    findings.push(candidate)
  }

  return { findings: findings.sort((a, b) => a.span.start - b.span.start), status: 'ready' }
}
