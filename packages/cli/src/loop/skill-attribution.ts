/**
 * Artifact-level fitness attribution for the canonical loop (#228 P3·2,
 * CLM-0140 — the MEASURE half of the learning loop #309 wired). When a run
 * completes, the skills whose BODY survived the token budget into the brief are
 * recorded against the run's Outcome via the observer fitness ledger, so the
 * evidence-gated ladder can answer "does reusing this distilled skill correlate
 * with better outcomes?".
 *
 * HONESTY: this is a CORRELATIONAL signal — "a run whose brief carried skill X
 * had outcome O" — NOT a causal claim that X caused O. When several skills
 * survive, the single whole-loop Outcome is credited to EACH of them (a
 * co-occurrence confound), so a per-skill success rate is "rate of runs that
 * carried the skill", not the skill's isolated value. A human reads the
 * aggregate; nothing here auto-acts.
 *
 * SAFETY: `ingestOutcome` only UPSERTs aggregate stats — it never changes a
 * tier. A `skill:<name>` subject feeds only the SUGGEST-tier lifecycle proposals
 * (human-ratified) and is INERT for routing: the router consults fitness priors
 * only for routable manifest candidates, and a skill is never a manifest.
 */
import { appendEvent } from '@kernloop/kernel';
import type { Brief, Outcome } from '@kernloop/contracts';
import { readEnvelopes } from '../tools/audit.js';
import type { LoopBindings } from './executors.js';

/**
 * Names of skills whose body SURVIVED the budget into `brief` — read from the
 * compiled `skillBodies` section's `skill:<name>:body` provenance, so a body the
 * budget DROPPED (never presented to the model) is correctly NOT attributed.
 */
export function survivingSkillNames(brief: Brief | undefined): string[] {
  const section = brief?.sections.find((s) => s.name === 'skillBodies');
  if (section === undefined) return [];
  const names: string[] = [];
  for (const p of section.provenance) {
    const name = /^skill:(.+):body$/.exec(p.ref)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** Whether this run already recorded an attribution — idempotency across a
 * resume that re-runs retrospect, so one run never double-counts (the #228 P3·2
 * vote condition). */
function alreadyAttributed(b: LoopBindings, runId: string): boolean {
  return readEnvelopes(b.kern.paths.audit).some(
    (e) => e.type === 'loop.skill.attributed' && (e.payload as { runId?: string }).runId === runId,
  );
}

/**
 * Attribute `outcome` to each surviving injected skill EXACTLY ONCE per run
 * (#228 P3·2, CLM-0140): ingest a correlational fitness signal per skill and
 * append one `loop.skill.attributed` audit event listing them. A no-op when no
 * skill body survived or this run was already attributed.
 */
export function attributeSkillFitness(b: LoopBindings, runId: string, outcome: Outcome): void {
  const skills = survivingSkillNames(b.refs.researchBrief);
  if (skills.length === 0 || alreadyAttributed(b, runId)) return;
  for (const name of skills) b.kern.observer.ingestOutcome(outcome, { subject: `skill:${name}` });
  appendEvent(b.kern.store, {
    type: 'loop.skill.attributed',
    payload: { runId, taskId: outcome.taskId, status: outcome.status, skills },
  });
}
