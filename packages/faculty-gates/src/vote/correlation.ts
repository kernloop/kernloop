/**
 * Correlation-aware aggregation helpers (#369 Inc4, CLM-0167), split from run.ts
 * for line budget. Voters that share a served model CLASS are not independent
 * evidence; these pure functions group ballots by served class and fold the
 * {@link correlationDiscount} into the per-voter weights, plus the VISIBLE finding
 * that discloses the downweighting. The grouping keys off the composition-root-
 * filled `served` identity (trusted adapter resolution, never ballot content), so a
 * voter cannot forge diversity to evade the discount.
 *
 * @module faculty-gates/vote/correlation
 */
import type { Finding, ModelIdentity, VoterRecord } from '@kernloop/contracts';
import { correlationDiscount, type CorrelationForm } from './strategies.js';

/** The normalized class key for a served {@link ModelIdentity} (#369). NUL-joined
 * (an internal grouping key, never human-facing) so a field value can't collide
 * across boundaries. */
export function identityKey(id: ModelIdentity): string {
  return [id.provider, id.family, id.generation, id.tier].join('\0');
}

/** How many ballots each served class cast (#369 Inc4) — voters with no served
 * identity (single-adapter panel) are not counted, so the map is empty there. */
function servedClassSizes(voters: readonly VoterRecord[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const v of voters) {
    if (v.served === undefined) continue;
    const key = identityKey(v.served);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return sizes;
}

/**
 * Effective per-voter weights folding the #369 Inc4 correlation discount into the
 * (precision) `base` weights: a voter in a served class of size K is scaled by
 * {@link correlationDiscount}(form, K), MULTIPLIED by its base weight. A voter with
 * no served identity is undiscounted, so when NO voter is served (single-adapter
 * panel) this returns the base weights verbatim — byte-identical aggregation.
 */
export function correlationWeights(
  voters: readonly VoterRecord[],
  base: readonly number[] | undefined,
  form: CorrelationForm,
): number[] {
  const sizes = servedClassSizes(voters);
  return voters.map((v, i) => {
    const b = base?.[i] ?? 1;
    if (v.served === undefined) return b;
    return b * correlationDiscount(form, sizes.get(identityKey(v.served)) ?? 1);
  });
}

/**
 * Visible `info` findings for the #369 Inc4 correlation discount — one per served
 * class that cast ≥2 ballots, naming the class (readable `provider/family`, not the
 * raw NUL-joined key) and the EFFECTIVE vote weight it was discounted to, so a human
 * ratifier sees the downweighting (never silent). A fully-diverse panel (every class
 * a singleton) yields no finding — nothing was discounted.
 */
export function correlationFindings(
  voters: readonly VoterRecord[],
  form: CorrelationForm,
): Finding[] {
  const classes = new Map<string, { n: number; id: ModelIdentity }>();
  for (const v of voters) {
    if (v.served === undefined) continue;
    const key = identityKey(v.served);
    const prior = classes.get(key);
    classes.set(key, { n: (prior?.n ?? 0) + 1, id: v.served });
  }
  const findings: Finding[] = [];
  for (const { n, id } of classes.values()) {
    if (n < 2) continue;
    const effective = (n * correlationDiscount(form, n)).toFixed(2);
    findings.push({
      severity: 'info',
      message: `vote correlation discount (#369 Inc4, ${form}): ${String(n)} ballots from class ${id.provider}/${id.family} counted as ${effective} effective votes (not independent)`,
    });
  }
  return findings;
}
