/**
 * `distill` — episodic trace → SKILL.md PROPOSAL at suggest tier (spec §3.4
 * distill row; §5.2 procedural store) [CLM-0049]. Gathers a recorded trace
 * summary (and, when the id names a checkpointed loop run, its node trace),
 * asks the model — through the loop's one injectable invoke seam — for a
 * skill distilled from what the trace actually did, and writes the result to
 * `<repo>/skills/proposed/<name>/` as SKILL.md + PROPOSAL.yaml.
 *
 * SUGGEST TIER, enforced structurally: distill PROPOSES; it never installs.
 * The live procedural library (`skills/<name>/`) has no runtime write path
 * anywhere in this codebase — a proposal goes live ONLY by a human moving
 * `skills/proposed/<name>/` to `skills/<name>/` through the ordinary
 * reviewed-PR path; that merge IS the ratification (CLM-0050, p3 design
 * notes open question 3, strictest reading). {@link resolveProposalDir} is
 * the only skills-path writer target resolution in the package, and it
 * cannot resolve outside `skills/proposed/`.
 *
 * Honesty rules: an absent trace is a typed {@link TraceNotFoundError},
 * never an invented input; model output crosses back under the loop's
 * STRICT one-JSON-object contract (violations are typed and the raw output
 * is preserved under `<overlay>/checkpoints/` for diagnosis); every written
 * proposal appends an audit event (constitutional rule 7).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import type { Cost } from '@kernloop/contracts';
import { appendEvent } from '@kernloop/kernel';
import type { TraceSummary } from '@kernloop/faculty-memory';
import { JsonlCheckpointStore } from '@kernloop/workflows';
import type { Kernloop } from './kernel.js';
import { checkpointFile } from './loop/index.js';
import { parseEmission, type LoopInvoke } from './loop/invoke.js';
import { resolveStandaloneInvoke } from './loop/standalone-invoke.js';

/** Typed failure: the id names no recorded episodic trace. */
export class TraceNotFoundError extends Error {
  readonly code = 'trace_not_found';
  constructor(trace: string) {
    super(
      `no episodic trace summary recorded for "${trace}" — distill works only from a real recorded Outcome, never an invented one`,
    );
    this.name = 'TraceNotFoundError';
  }
}

/** Typed failure: a proposed skill name that is not a safe kebab-case directory name. */
export class SkillNameError extends Error {
  readonly code = 'invalid_skill_name';
  constructor(name: string, reason: string) {
    super(`proposed skill name "${name}" rejected: ${reason}`);
    this.name = 'SkillNameError';
  }
}

/** Legal proposed-skill names: kebab-case, one path segment, bounded. */
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Maximum length of a proposed skill name (a directory name, not prose). */
export const SKILL_NAME_MAX = 64;

/** The model's raw skill proposal — the strict distill output contract [CLM-0049]. */
export const SkillProposalEmissionSchema = z.strictObject({
  name: z.string().min(1),
  oneLiner: z.string().min(1),
  body: z.string().min(1),
});

/** The PROPOSAL.yaml record plus where the artifacts landed and what the call cost. */
export interface SkillProposal {
  readonly name: string;
  readonly oneLiner: string;
  /** Task id of the episodic trace this skill was distilled from. */
  readonly sourceTrace: string;
  readonly proposedAt: string;
  /** Distill enters the ladder at suggest: it proposes, never installs [CLM-0049]. */
  readonly tier: 'suggest';
  readonly status: 'proposed';
  /** `<repo>/skills/proposed/<name>/SKILL.md`. */
  readonly skillFile: string;
  /** `<repo>/skills/proposed/<name>/PROPOSAL.yaml`. */
  readonly proposalFile: string;
  /** Metered (or honestly zero) model spend for the distill call. */
  readonly cost: Cost;
}

/** One distill request. */
export interface DistillRequest {
  readonly kern: Kernloop;
  /** Task id of the recorded trace; also probed as a loop run id for checkpoints. */
  readonly trace: string;
  /** Adapter the default invoke binds to (default `claude`): CLI name OR endpoint id (#395). */
  readonly adapter?: string;
  /** Injectable model seam (tests script it); default: the kernel adapter. */
  readonly invoke?: LoopInvoke;
}

/** The proposed-skills area — the ONLY skills path runtime code writes [CLM-0050]. */
export function proposedSkillsRoot(repoRoot: string): string {
  return path.resolve(repoRoot, 'skills', 'proposed');
}

/**
 * Resolve where a proposal may be written: `<repo>/skills/proposed/<name>/`,
 * and nowhere else. The name must be kebab-case (one path segment by
 * construction) AND the resolved directory must be a direct child of the
 * proposed root — so a traversal (`../evil`), an absolute path, or any other
 * escape is a typed {@link SkillNameError}, never a write into the live
 * library [CLM-0050].
 */
export function resolveProposalDir(repoRoot: string, name: string): string {
  if (name.length > SKILL_NAME_MAX) {
    throw new SkillNameError(name, `longer than ${String(SKILL_NAME_MAX)} characters`);
  }
  if (!SKILL_NAME.test(name)) {
    throw new SkillNameError(name, 'must be kebab-case ([a-z0-9] groups joined by single dashes)');
  }
  const root = proposedSkillsRoot(repoRoot);
  const dir = path.resolve(root, name);
  /* v8 ignore start -- structural backstop: unreachable while SKILL_NAME
     admits only single path segments, kept so a future regex loosening can
     never silently open an escape from skills/proposed/ [CLM-0050] */
  if (path.dirname(dir) !== root) {
    throw new SkillNameError(name, `resolves outside ${root}`);
  }
  /* v8 ignore stop */
  return dir;
}

/** Render the executed-node lines of a loop run's latest checkpoint, oldest first. */
async function gatherNodeTrace(overlayDir: string, runId: string): Promise<string[]> {
  const store = new JsonlCheckpointStore(checkpointFile(overlayDir, runId));
  const latest = await store.latest(runId);
  if (latest === undefined) return [];
  return latest.state.trace.map(
    (entry) =>
      `${String(entry.seq)}. ${entry.node} (iteration ${String(entry.iteration)})` +
      (entry.childId === undefined ? '' : ` child=${entry.childId}`),
  );
}

/** The distill prompt: honest trace inputs + the strict output contract. */
function distillPrompt(summary: TraceSummary, nodeTrace: readonly string[]): string {
  return [
    'You are distilling a reusable skill from ONE completed task trace.',
    'Describe only what the trace actually did — never what it should have done.',
    '',
    '## Episodic trace summary',
    `- task: ${summary.taskId}`,
    `- status: ${summary.status}`,
    `- summary: ${summary.summary}`,
    `- traceRef: ${summary.traceRef}`,
    ...(summary.distillCandidates.length === 0
      ? []
      : [`- distill candidates: ${summary.distillCandidates.join(', ')}`]),
    ...(nodeTrace.length === 0 ? [] : ['', '## Loop nodes executed', ...nodeTrace]),
    '',
    '## Output contract (STRICT)',
    'Respond with ONE raw JSON object and nothing else — no prose, no fences:',
    '{"name":"<kebab-case skill name>","oneLiner":"<one-line description>","body":"<full SKILL.md markdown>"}',
    'The body is a complete SKILL.md: a `# <name>` heading, the one-line',
    'description as the first body line, a "When to use" section, and a',
    '"Steps" section with the concrete steps the trace performed.',
  ].join('\n');
}

/** Write the proposal artifacts under skills/proposed/ and audit the act. */
function writeProposal(
  kern: Kernloop,
  emission: z.output<typeof SkillProposalEmissionSchema>,
  sourceTrace: string,
  cost: Cost,
): SkillProposal {
  const dir = resolveProposalDir(kern.paths.repoRoot, emission.name);
  const proposal: SkillProposal = {
    name: emission.name,
    oneLiner: emission.oneLiner,
    sourceTrace,
    proposedAt: new Date().toISOString(),
    tier: 'suggest',
    status: 'proposed',
    skillFile: path.join(dir, 'SKILL.md'),
    proposalFile: path.join(dir, 'PROPOSAL.yaml'),
    cost,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(proposal.skillFile, emission.body, 'utf8');
  const { name, oneLiner, proposedAt, tier, status } = proposal;
  writeFileSync(
    proposal.proposalFile,
    YAML.stringify({ name, oneLiner, sourceTrace, proposedAt, tier, status }),
    'utf8',
  );
  appendEvent(kern.store, {
    type: 'cli.distill.proposed',
    payload: { name, sourceTrace, skillFile: proposal.skillFile, tier, status },
  });
  return proposal;
}

/**
 * Distill one recorded episodic trace into a proposed skill [CLM-0049]. The
 * proposal lands under `skills/proposed/<name>/` at suggest tier; promotion
 * into the live library is the human-reviewed git path, never this function
 * [CLM-0050]. Re-distilling a name replaces the proposal (proposals are
 * derived artifacts; each write is audited).
 */
export async function distillFromTrace(request: DistillRequest): Promise<SkillProposal> {
  const { kern, trace } = request;
  const summary = kern.memory.getTraceSummary(trace);
  if (summary === undefined) throw new TraceNotFoundError(trace);
  const nodeTrace = await gatherNodeTrace(kern.paths.dir, trace);
  const adapter = request.adapter ?? 'claude';
  // A CLI adapter name OR a registered endpoint id (#395) — resolved CLI-or-endpoint.
  const invoke = request.invoke ?? resolveStandaloneInvoke(kern, adapter);
  const { output, cost } = await invoke(distillPrompt(summary, nodeTrace));
  const emission = parseEmission(output, SkillProposalEmissionSchema, 'skill-proposal', {
    overlayDir: kern.paths.dir,
    runId: trace,
    node: 'distill',
  });
  return writeProposal(kern, emission, summary.taskId, cost);
}
