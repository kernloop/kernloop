/**
 * Seed the Router's fitness priors FROM the reviewed `.kernloop/priors.yaml`
 * (spec §7; closes the export↔seed loop, CLM-0126). `kernloop priors export`
 * writes the reviewable file; this loader reads it back at the run composition
 * root so a committed, reviewed prior actually BIASES routing — under an
 * explicit `router.seedPriors` opt-in (overlay.ts), never by default.
 *
 * Three honesty properties hold here:
 * - DEGRADE TO NEUTRAL: a missing, oversized, malformed, or schema-invalid
 *   file returns null (a warning, never a throw) — routing falls back to the
 *   Router's neutral prior, byte-identical to today's prior-agnostic behavior.
 * - LAPLACE SMOOTHING: the per-subject score is additively smoothed, so a
 *   thin sample (1 invocation at 100%) cannot dominate a deep one — the raw
 *   successRate is never used as the prior.
 * - BIAS, NOT ELIMINATE: the score only ranks ELIGIBLE candidates; the
 *   Router's exploration floor + neutral fallback (CLM-0028) stay intact, so a
 *   subject absent from priors.yaml is still selectable.
 *
 * The kernel Router is untouched — it already accepts `fitnessPriors`
 * (CLM-0028); this module is the wiring point, not a router change.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import YAML from 'yaml';
import { appendEvent, type AuditStore } from '@kernloop/kernel';

/** Reject a priors.yaml larger than this — a runaway file degrades to neutral, never OOMs. */
export const MAX_PRIORS_BYTES = 1_000_000;

/**
 * The loader's TOLERANT view of priors.yaml — a deliberate superset of the
 * exporter's strict `PriorsExportSchema`. `invocations` DEFAULTS to 0 so a
 * file written before that field existed (CLM-0070) still loads: that subject
 * degrades to a low-confidence neutral score (Laplace over 0 → 0.5), never a
 * whole-file rejection. Unknown keys are ignored (forward-compatible) rather
 * than rejected, since priors.yaml is reviewed data the loader only reads.
 */
const SeedPriorSchema = z.object({
  subject: z.string().min(1),
  invocations: z.number().int().nonnegative().default(0),
  successRate: z.number().min(0).max(1),
  lastUsedAt: z.number().int().nonnegative(),
});
const SeedPriorsFileSchema = z.object({
  version: z.literal('1'),
  priors: z.array(SeedPriorSchema),
});

/** Staleness threshold (ms): a priors.yaml whose newest outcome predates this warns. */
export const STALE_PRIORS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** One subject's DISCOUNTED (Laplace-smoothed) prior, recorded for reproducibility. */
export interface SeedScore {
  readonly subject: string;
  /** The Laplace-smoothed score actually handed to the Router (NOT the raw successRate). */
  readonly score: number;
  /** Sample size the score was smoothed over (0 when the file predates the field). */
  readonly invocations: number;
}

/** The result of seeding priors from a present, valid priors.yaml. */
export interface SeedResult {
  /** `subject` → Laplace-smoothed score, keyed for the Router's `name@version`/`name` lookup. */
  readonly map: Map<string, number>;
  /** Number of seeded subjects. */
  readonly count: number;
  /** Hex sha256 of the raw file bytes — provenance for the audit event. */
  readonly sha256: string;
  /** Per-subject discounted scores, recorded so a routing decision is reproducible. */
  readonly scores: SeedScore[];
  /** now − max(lastUsedAt) across the file — a staleness signal in ms. */
  readonly ageMs: number;
}

/**
 * Laplace (additive) smoothing of a subject's success rate by its sample size:
 * `score = (successes + 1) / (invocations + 2)` where
 * `successes = round(successRate * invocations)`. Deterministic and pure. This
 * pulls a 1-invocation/100% subject to 0.667 and a 50-invocation/90% subject
 * to 0.885 — the high-sample one ranks higher, so a thin sample cannot
 * dominate routing. A 0-invocation subject degrades to the neutral 0.5.
 */
export function laplaceScore(successRate: number, invocations: number): number {
  const successes = Math.round(successRate * invocations);
  return (successes + 1) / (invocations + 2);
}

/**
 * Load and Laplace-smooth the reviewed priors.yaml at `overlayPriorsPath`
 * (CLM-0126), returning null when the file is ABSENT (today's neutral
 * behavior, byte-identical) or when it is oversized / malformed /
 * schema-invalid (a logged warning, never a throw). The returned map BIASES
 * but does not eliminate candidates — the Router's exploration floor + neutral
 * fallback stay intact. `clock` is injectable for a deterministic `ageMs`.
 */
export function loadSeedPriors(
  overlayPriorsPath: string,
  clock: () => number = Date.now,
): SeedResult | null {
  let raw: string;
  try {
    const stat = statSync(overlayPriorsPath);
    if (stat.size > MAX_PRIORS_BYTES) {
      console.warn(
        `priors.yaml is ${String(stat.size)} bytes (> ${String(MAX_PRIORS_BYTES)} cap) — skipping seed, routing stays neutral`,
      );
      return null;
    }
    raw = readFileSync(overlayPriorsPath, 'utf8');
  } catch {
    // ENOENT (absent file) is the common, expected case: no warning, neutral.
    return null;
  }
  let parsed: unknown;
  try {
    // SAFE mode: no custom tags (e.g. `!!js`) — priors.yaml is reviewed data,
    // but a malformed/hostile file must degrade, never honor an exotic tag. An
    // unknown tag resolves to its inert string scalar (then fails the schema
    // below), and `logLevel: silent` keeps that benign warning off CI output.
    parsed = YAML.parse(raw, { customTags: [], logLevel: 'silent' });
  } catch (error) {
    console.warn(
      `priors.yaml is not valid YAML (${error instanceof Error ? error.message : String(error)}) — skipping seed, routing stays neutral`,
    );
    return null;
  }
  const result = SeedPriorsFileSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`priors.yaml failed validation — skipping seed, routing stays neutral`);
    return null;
  }
  const map = new Map<string, number>();
  const scores: SeedScore[] = [];
  let newestUsedAt = 0;
  for (const prior of result.data.priors) {
    const score = laplaceScore(prior.successRate, prior.invocations);
    map.set(prior.subject, score);
    scores.push({ subject: prior.subject, score, invocations: prior.invocations });
    if (prior.lastUsedAt > newestUsedAt) newestUsedAt = prior.lastUsedAt;
  }
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const ageMs = newestUsedAt === 0 ? 0 : Math.max(0, clock() - newestUsedAt);
  return { map, count: map.size, sha256, scores, ageMs };
}

/**
 * The `fitnessPriors` fragment for the Router's `route()` at the run
 * composition root (CLM-0126). When `enabled` (the overlay's explicit
 * `router.seedPriors` opt-in) and `priorsPath` loads, appends one
 * `cli.router.priors-seeded` audit event recording the per-subject DISCOUNTED
 * scores actually applied + the file sha256 (rule 7 — reproducible); a stale
 * file (newest outcome older than {@link STALE_PRIORS_MS}) also warns and flags
 * `stale: true`. Returns an EMPTY fragment — no priors, no audit event,
 * byte-identical to today — when the opt-in is off OR the file degrades.
 */
export function seededPriorsFor(
  enabled: boolean,
  priorsPath: string,
  store: AuditStore,
  taskId: string,
): { fitnessPriors?: Map<string, number> } {
  if (!enabled) return {};
  const seeded = loadSeedPriors(priorsPath);
  if (seeded === null) return {};
  const stale = seeded.ageMs > STALE_PRIORS_MS;
  if (stale) {
    console.warn(
      `priors.yaml is stale (newest outcome ${String(Math.round(seeded.ageMs / 86_400_000))} days old) — seeding routing anyway; re-export to refresh`,
    );
  }
  appendEvent(store, {
    type: 'cli.router.priors-seeded',
    payload: {
      taskId,
      source: priorsPath,
      count: seeded.count,
      sha256: seeded.sha256,
      ageMs: seeded.ageMs,
      stale,
      scores: seeded.scores.map((s) => ({
        subject: s.subject,
        score: s.score,
        invocations: s.invocations,
      })),
    },
  });
  return { fitnessPriors: seeded.map };
}
