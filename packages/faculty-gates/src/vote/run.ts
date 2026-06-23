/**
 * The vote gate runner (spec §5.3): invokes a panel of voters concurrently
 * over one shared compiled Brief, aggregates their ballots under a ported
 * consensus strategy, and emits one zod-validated Verdict (CLM-0037).
 *
 * The faculty stays model-free in substance: voters call models, but model
 * invocation arrives as the injected `invokeVoter` dependency, bound to the
 * kernel adapters by the composition root (design notes, open question 1 —
 * faculties cannot import kernel). Every voter receives the SAME Brief
 * value — one compile, n voters (spec §8.3, CLM-0039); there is no
 * per-voter recompilation hook anywhere in this API.
 */
import { z } from 'zod';
import {
  CostSchema,
  ModelIdentitySchema,
  VerdictSchema,
  type Brief,
  type Cost,
  type Finding,
  type ModelIdentity,
  type Verdict,
  type VoterRecord,
} from '@kernloop/contracts';
import { aggregateVotes, type CorrelationForm, type VoteStrategy } from './strategies.js';
import { correlationFindings, correlationWeights, identityKey } from './correlation.js';
import { PANEL_DEFAULT, type VoterTemplate } from './voters.js';

/**
 * What the injected `invokeVoter` must return — zod-validated on receipt so
 * a malformed ballot is caught at the boundary (an invalid ballot is
 * treated as a voter error, never coerced into a vote).
 */
export const VoterBallotSchema = z.strictObject({
  vote: z.enum(['approve', 'reject', 'abstain']),
  reasoning: z.string(),
  cost: CostSchema,
  /**
   * The normalized model CLASS that cast this ballot (#369) — the composition
   * root fills it when a provider-DIVERSE panel routed this voter to a distinct
   * adapter (the faculty stays model-free; it just passes this through to the
   * {@link VoterRecord}). Absent on a single-adapter panel.
   */
  served: ModelIdentitySchema.optional(),
});
/** One voter's returned ballot — see {@link VoterBallotSchema}. */
export type VoterBallot = z.infer<typeof VoterBallotSchema>;

/**
 * Injected voter invocation (the model call, owned by the composition
 * root). Receives the voter template, the one shared Brief, and the
 * proposal under vote.
 */
export type InvokeVoter = (
  voter: VoterTemplate,
  brief: Brief,
  proposal: string,
) => Promise<VoterBallot>;

/** Options for {@link runVoteGate}. */
export interface RunVoteGateOptions {
  /** Task the verdict judges (Verdict.taskId). */
  readonly taskId: string;
  /** The proposal text the panel votes on. */
  readonly proposal: string;
  /** The one compiled Brief shared by every voter (CLM-0039). */
  readonly brief: Brief;
  /** Panel to convene; defaults to {@link PANEL_DEFAULT} (3 voters). */
  readonly panel?: readonly VoterTemplate[];
  /** Consensus strategy; defaults to `simple_majority`. */
  readonly strategy?: VoteStrategy;
  /**
   * When true (#192), a panel that DEADLOCKS (neither the approve bar nor the
   * symmetric reject bar clears) emits `escalate` instead of `reject` — the
   * loop then halts as escalated for a human to rule. Default false ⇒ a deadlock
   * still resolves to `reject`, byte-identical to prior behavior.
   */
  readonly escalateOnNoConsensus?: boolean;
  /**
   * Per-voter vote WEIGHTS in panel order (#369 Inc3): a calibrated voter's ballot
   * counts for more (see {@link precisionWeight}). Omitted ⇒ equal weights, an
   * integer tally (byte-identical). The composition root computes these from the
   * Observer's per-voter precision; the faculty just applies them. NOTE: when
   * weights are applied the Verdict's `confidence` is the WEIGHTED approve share,
   * not a head-count ratio.
   */
  readonly weights?: readonly number[];
  /**
   * Correlation-aware aggregation (#369 Inc4, opt-in): when true, voters that share
   * a served model CLASS are downweighted by {@link correlationDiscount} for the
   * class size K (composed MULTIPLICATIVELY with {@link weights}), so a
   * provider-correlated bloc counts toward its effective-independent size rather
   * than its head-count. Voters with no `served` (a single-adapter panel) are
   * undiscounted, so an unenabled OR single-adapter panel is byte-identical. The
   * discount is surfaced as a VISIBLE `info` Verdict finding (raw → effective),
   * never silent. Requires the composition root to fill `served` from TRUSTED
   * adapter/registry resolution, never ballot-supplied content (else a voter could
   * forge diversity to evade the discount).
   */
  readonly correlationAware?: boolean;
  /** The {@link CorrelationForm} for {@link correlationAware} (default `sqrt`). */
  readonly correlationForm?: CorrelationForm;
  /**
   * Distinct-class INDEPENDENCE quorum (#405/#369 Inc5b): require at least this many
   * DISTINCT served model classes among the panel's ballots, else the panel is too
   * correlated to rule and the gate emits `escalate` (ask a human) instead of
   * DECIDING — closing the named honesty gap where a single-oracle ratification could
   * still auto-approve. It counts distinct served CLASSES (independence), NOT raw
   * ballots: 5/7 ballots of one class is 1 class, not 5 (the Architect's catch). Only
   * engages on a DIVERSE panel whose ballots carry `served`; a single-adapter /
   * endpoint-only panel (no `served`) is byte-identical. Explicitly set ⇒ overrides
   * the {@link ratificationProfile} default; set to 1 (or 0) to DISABLE it on a
   * ratification panel (the overlay opt-out).
   */
  readonly minDistinctClasses?: number;
  /**
   * Marks a panel-7 RATIFICATION vote (#405). When true, {@link minDistinctClasses}
   * DEFAULTS to 2 — the human-ratified default-ON for the ratification profile: a
   * single-oracle ratification must not auto-approve, it escalates to a human. A panel
   * that is NOT a ratification profile (a panel-3 loop vote) is unaffected, and an
   * explicit {@link minDistinctClasses} overrides this default either way.
   */
  readonly ratificationProfile?: boolean;
  /** The injected model call — see {@link InvokeVoter}. */
  readonly invokeVoter: InvokeVoter;
}

/** Findings cap: a dissenter's reasoning is truncated to this length. */
export const FINDING_REASONING_CAP = 300;

/** Zero cost for ballots that never came back (voter errors). */
const ZERO_COST: Cost = { tokens: 0, usd: 0 };

/**
 * Invoke one voter, never letting a failure escape: a thrown `invokeVoter`
 * or a schema-invalid ballot is recorded as an `abstain` with
 * `voter_error: …` reasoning and zero cost — the gate never fabricates a
 * vote on a voter's behalf (CLM-0038: what is recorded is what happened).
 */
async function castBallot(
  invokeVoter: InvokeVoter,
  voter: VoterTemplate,
  brief: Brief,
  proposal: string,
): Promise<VoterBallot> {
  let raw: unknown;
  try {
    raw = await invokeVoter(voter, brief, proposal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { vote: 'abstain', reasoning: `voter_error: ${message}`, cost: ZERO_COST };
  }
  const parsed = VoterBallotSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return {
      vote: 'abstain',
      reasoning: `voter_error: invalid ballot: ${message}`,
      cost: ZERO_COST,
    };
  }
  return parsed.data;
}

/** Sum voter costs; wall clock is the panel's measured time, not a sum. */
function sumCosts(ballots: readonly VoterBallot[], wallClockMs: number): Cost {
  let tokens = 0;
  let usd = 0;
  const byAdapter: Record<string, { tokens: number; usd: number }> = {};
  let hasAdapterBreakdown = false;
  for (const ballot of ballots) {
    tokens += ballot.cost.tokens;
    usd += ballot.cost.usd;
    for (const [adapter, slice] of Object.entries(ballot.cost.byAdapter ?? {})) {
      hasAdapterBreakdown = true;
      const prior = byAdapter[adapter] ?? { tokens: 0, usd: 0 };
      byAdapter[adapter] = { tokens: prior.tokens + slice.tokens, usd: prior.usd + slice.usd };
    }
  }
  return hasAdapterBreakdown
    ? { tokens, usd, wallClockMs, byAdapter }
    : { tokens, usd, wallClockMs };
}

/**
 * One `warn` finding per dissenting voter — every voter whose ballot was
 * not `approve` (rejections and abstentions both dissent from consensus;
 * voter errors surface here as their `voter_error: …` reasoning). Message
 * carries the reasoning, capped at {@link FINDING_REASONING_CAP} chars.
 */
function dissentFindings(voters: readonly VoterRecord[]): Finding[] {
  return voters
    .filter((record) => record.vote !== 'approve')
    .map((record) => {
      const reasoning = record.reasoning.length > 0 ? record.reasoning : '(no reasoning given)';
      const capped =
        reasoning.length > FINDING_REASONING_CAP
          ? `${reasoning.slice(0, FINDING_REASONING_CAP)}…`
          : reasoning;
      return {
        severity: 'warn' as const,
        message: `voter "${record.voter}" voted ${record.vote}: ${capped}`,
      };
    });
}

/**
 * The distinct-class INDEPENDENCE quorum (#405/#369 Inc5b). Returns the escalation
 * REASON when the panel's surviving ballots span FEWER distinct served model classes
 * than required — the panel is too correlated to rule, so the gate asks a human rather
 * than DECIDING on a single-oracle (or under-diverse) panel. Returns undefined when the
 * quorum is OFF (no `minDistinctClasses` and not a ratification profile, or the knob is
 * disabled at ≤1), when the panel is single-adapter / endpoint-only (no `served` — by
 * design byte-identical), or when the quorum is MET. Counts distinct served CLASSES via
 * {@link identityKey}, never raw ballot count.
 */
export function distinctClassQuorum(
  voters: readonly VoterRecord[],
  minDistinctClasses: number | undefined,
  ratificationProfile: boolean,
): string | undefined {
  const required = minDistinctClasses ?? (ratificationProfile ? 2 : undefined);
  if (required === undefined || required <= 1) return undefined;
  const served = voters.map((v) => v.served).filter((s): s is ModelIdentity => s !== undefined);
  if (served.length === 0) return undefined; // single-adapter / endpoint-only: byte-identical
  const classes = new Set(served.map(identityKey));
  if (classes.size >= required) return undefined;
  return `vote panel BELOW INDEPENDENCE QUORUM (#405): ${String(classes.size)} distinct model class(es) among ${String(served.length)} ballots, below the ${String(required)} required to RULE on a ratification — escalating to a human rather than auto-deciding on a correlated panel`;
}

/**
 * Compose the Verdict's RESULT and FINDINGS from the cast ballots: the tally result,
 * possibly OVERRIDDEN to `escalate` by the distinct-class independence quorum
 * (#405/#369 Inc5b), and the full finding list (per-voter dissent + diversity +
 * correlation + the quorum-escalation cause). The quorum override surfaces a VISIBLE
 * warn finding so the human ratifier sees both the tally AND why it was not trusted to
 * auto-decide; off / single-adapter panel ⇒ the base result and no quorum finding.
 */
function resultAndFindings(
  voters: readonly VoterRecord[],
  options: RunVoteGateOptions,
  form: CorrelationForm,
  baseResult: 'approve' | 'reject' | 'abstain' | 'escalate',
): { result: 'approve' | 'reject' | 'abstain' | 'escalate'; findings: Finding[] } {
  const quorumReason = distinctClassQuorum(
    voters,
    options.minDistinctClasses,
    options.ratificationProfile ?? false,
  );
  return {
    result: quorumReason === undefined ? baseResult : 'escalate',
    findings: [
      ...dissentFindings(voters),
      ...diversityFindings(voters),
      ...(options.correlationAware ? correlationFindings(voters, options.weights, form) : []),
      ...(quorumReason === undefined ? [] : [{ severity: 'warn' as const, message: quorumReason }]),
    ],
  };
}

/**
 * Convene the panel and emit one Verdict (CLM-0037). Voters are
 * independent: all are invoked concurrently via `Promise.all`, each with
 * the same shared Brief value (CLM-0039), and the resulting VoterRecords
 * preserve panel order, so output is deterministic for given ballots
 * (CLM-0038). The Verdict is `VerdictSchema`-validated before return — an
 * invalid verdict throws rather than escaping.
 */
export async function runVoteGate(options: RunVoteGateOptions): Promise<Verdict> {
  const panel = options.panel ?? PANEL_DEFAULT;
  const strategy = options.strategy ?? 'simple_majority';
  if (panel.length === 0) {
    throw new Error('vote gate: panel must contain at least one voter');
  }
  const started = Date.now();
  const ballots = await Promise.all(
    panel.map((voter) => castBallot(options.invokeVoter, voter, options.brief, options.proposal)),
  );
  const voters: VoterRecord[] = panel.map((voter, i) => {
    const ballot = ballots[i] as VoterBallot;
    return {
      voter: voter.name,
      vote: ballot.vote,
      reasoning: ballot.reasoning,
      ...(ballot.served === undefined ? {} : { served: ballot.served }),
    };
  });
  // Correlation-aware aggregation (#369 Inc4, opt-in): fold the per-class discount
  // into the (precision) weights so a provider-correlated bloc counts toward its
  // effective-independent size. Off OR a single-adapter panel ⇒ base weights verbatim.
  const form: CorrelationForm = options.correlationForm ?? 'sqrt';
  const effectiveWeights = options.correlationAware
    ? correlationWeights(voters, options.weights, form)
    : options.weights;
  const outcome = aggregateVotes(
    strategy,
    ballots.map((b) => b.vote),
    options.escalateOnNoConsensus ?? false,
    effectiveWeights,
  );
  const { result, findings } = resultAndFindings(voters, options, form, outcome.result);
  return VerdictSchema.parse({
    taskId: options.taskId,
    gate: 'vote',
    result,
    confidence: outcome.confidence,
    findings,
    voters,
    cost: sumCosts(ballots, Date.now() - started),
  });
}

/**
 * Voters whose ballot ERRORED (the routed adapter was uncallable at vote time —
 * authed-out, quota, or crashed), recorded as a `voter_error:` abstain by
 * {@link castBallot}. PATH-availability is enforced at run setup, so on a diverse
 * panel these are the runtime (auth/quota) failures that slip past it (#371).
 */
function adapterFailureCount(voters: readonly VoterRecord[]): number {
  return voters.filter((v) => v.vote === 'abstain' && v.reasoning.startsWith('voter_error:'))
    .length;
}

/**
 * Diversity findings for a provider-diverse panel (#369, #371), surfaced ON THE VERDICT
 * so a human ratifier SEES whether the panel was genuinely independent — never
 * only in the audit log. Computed from what the faculty has (the ballots' served
 * identities); the composition root fills `served` only on a diverse (panel-7)
 * vote, so a single-adapter panel-3 (no `served`) yields no finding.
 *  - NONE served ⇒ no finding (a single-adapter panel by design).
 *  - all served collapse to ONE class ⇒ a `warn` single-oracle finding: the panel
 *    ran degraded (only one provider available), so it is NOT independent.
 *  - one class cast a MAJORITY of the ballots ⇒ an `info` skew finding (the
 *    availability-tie bias: e.g. 7 voters over 2 adapters is a 4/3 split).
 */
function diversityFindings(voters: readonly VoterRecord[]): Finding[] {
  const served = voters.map((v) => v.served).filter((s): s is ModelIdentity => s !== undefined);
  if (served.length === 0) return [];
  const findings: Finding[] = [];
  const failures = adapterFailureCount(voters);
  if (failures > 0) {
    findings.push({
      severity: 'warn',
      message: `vote panel DILUTED (#371): ${String(failures)} of ${String(voters.length)} voters failed (adapter error); only ${String(served.length)} independent ballots counted, so a close ratification may turn on the dropped voters`,
    });
  }
  const counts = new Map<string, { n: number; id: ModelIdentity }>();
  for (const id of served) {
    const prior = counts.get(identityKey(id));
    counts.set(identityKey(id), { n: (prior?.n ?? 0) + 1, id });
  }
  if (counts.size === 1) {
    findings.push({
      severity: 'warn',
      message: `vote panel ran SINGLE-ORACLE (#369): all ${String(served.length)} ballots from one model class — not independent (only one provider available)`,
    });
    return findings;
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0] as { n: number; id: ModelIdentity };
  if (top.n * 2 > served.length) {
    findings.push({
      severity: 'info',
      message: `vote panel diversity SKEW (#369): one model class (${top.id.provider}/${top.id.family}) cast ${String(top.n)}/${String(served.length)} ballots`,
    });
  }
  return findings;
}
