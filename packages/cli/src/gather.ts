/**
 * Brief-source gathering (spec §5.1). The compiler is a pure function; the
 * composition root gathers its inputs here — overlay claims registry,
 * semantic memory (provenance-ranked by the faculty), episodic summaries,
 * repo-state probes (real `git` subprocesses), and the skills index (names +
 * one-liners only, spec §8 item 2) — and hands them over as typed data.
 * Nothing here is fabricated: a source that does not exist on disk simply
 * contributes nothing.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { runSubprocess } from '@kernloop/kernel';
import { compileBrief, type BriefSources } from '@kernloop/faculty-compiler';
import type { Brief, TaskContract } from '@kernloop/contracts';
import type { Kernloop } from './kernel.js';

/** Wall-clock budget for one repo probe subprocess. */
const PROBE_TIMEOUT_MS = 10_000;

/** Read claims-registry entries (`claims/registry/*.yaml`) under the repo root. */
export function gatherClaims(repoRoot: string): NonNullable<BriefSources['claims']> {
  const dir = path.join(repoRoot, 'claims', 'registry');
  if (!existsSync(dir)) return [];
  const entries: NonNullable<BriefSources['claims']> = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    let doc: unknown;
    try {
      doc = YAML.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue; // unreadable registry file contributes nothing — never invented
    }
    if (typeof doc !== 'object' || doc === null) continue;
    const { id, statement, status } = doc as Record<string, unknown>;
    if (typeof id === 'string' && typeof statement === 'string' && typeof status === 'string') {
      entries.push({ id, statement: statement.trim(), status });
    }
  }
  return entries;
}

/** Run one git probe; a failed or missing git contributes nothing. */
async function gitProbe(
  repoRoot: string,
  name: string,
  args: string[],
): Promise<{ name: string; content: string; source: string } | null> {
  try {
    const result = await runSubprocess({
      command: 'git',
      args: ['-C', repoRoot, ...args],
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return null;
    return { name, content: result.stdout.trimEnd(), source: `git ${args.join(' ')}` };
  } catch {
    return null;
  }
}

/** Real repo-state probes (spec §5.1): `git status --short` + recent log. */
export async function gatherRepoProbes(
  repoRoot: string,
): Promise<NonNullable<BriefSources['repoProbes']>> {
  const probes = await Promise.all([
    gitProbe(repoRoot, 'git-status', ['status', '--short']),
    gitProbe(repoRoot, 'git-log', ['log', '--oneline', '-5']),
  ]);
  return probes.filter((p) => p !== null);
}

/** First non-empty, non-heading line of a markdown body, or null. */
function firstBodyLine(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

/**
 * Skills index: every committed `skills/<name>/SKILL.md`, as name +
 * one-liner only (spec §5.1 — bodies load on demand). `skills/proposed/**`
 * is EXCLUDED: distill writes proposals there at suggest tier, and a skill
 * enters the live library only through the human-reviewed git ratification
 * path [CLM-0050] — the index never serves an unratified proposal. An empty
 * index is the honest index.
 */
export function gatherSkillsIndex(repoRoot: string): NonNullable<BriefSources['skillsIndex']> {
  const dir = path.join(repoRoot, 'skills');
  if (!existsSync(dir)) return [];
  const index: NonNullable<BriefSources['skillsIndex']> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'proposed') continue; // unratified proposals are not the library [CLM-0050]
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const oneLiner = firstBodyLine(readFileSync(skillFile, 'utf8'));
    if (oneLiner !== null) index.push({ name: entry.name, oneLiner });
  }
  return index;
}

/**
 * Common words carrying no relevance signal — dropped before scoring so a goal
 * like "add a greet feature" doesn't match every skill on "add"/"feature" (#228
 * P3·1 vote: avoid spurious lexical matches). Deliberately small + deterministic.
 */
const RELEVANCE_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'add',
  'fix',
  'update',
  'make',
  'create',
  'implement',
  'feature',
  'to',
  'of',
  'and',
  'or',
  'for',
  'in',
  'on',
  'with',
  'that',
  'this',
  'it',
  'is',
  'as',
  'use',
  'using',
  'via',
  'new',
  'change',
  'support',
  'so',
  'into',
  'from',
  'when',
]);

/** Case-folded alphanumeric tokens of `text`, minus stop-words and 1-char tokens. */
function relevanceTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(tokens.filter((t) => t.length > 1 && !RELEVANCE_STOPWORDS.has(t)));
}

/** Max skill bodies injected per brief — a small documented cap (#228 P3·1): offer
 * the most relevant procedures, not the whole library. */
const MAX_SKILL_BODIES = 3;

/**
 * Skill BODIES relevant to `goal` (#228 P3·1, CLM-0139): every LIVE
 * `skills/<name>/SKILL.md` (`proposed/` EXCLUDED — CLM-0050) whose name +
 * one-liner shares ≥1 non-stop-word token with the goal, ranked by overlap COUNT
 * descending with a code-unit (locale-INDEPENDENT) name tie-break, top
 * {@link MAX_SKILL_BODIES}. DETERMINISTIC: same repo + goal ⇒ same ordered bodies
 * (CLM-0029). The gate is LEXICAL, not semantic — a cheap honest filter that keeps
 * the brief token budget honest, never a claim of perfect matching. The compiler
 * injects these as a lowest-priority, budget-capped section.
 */
export function gatherSkillBodies(
  repoRoot: string,
  goal: string,
): NonNullable<BriefSources['skillBodies']> {
  const dir = path.join(repoRoot, 'skills');
  if (!existsSync(dir)) return [];
  const goalTokens = relevanceTokens(goal);
  if (goalTokens.size === 0) return [];
  const scored: { name: string; body: string; score: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'proposed') continue; // unratified [CLM-0050]
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const body = readFileSync(skillFile, 'utf8');
    const skillTokens = relevanceTokens(`${entry.name} ${firstBodyLine(body) ?? ''}`);
    let score = 0;
    for (const t of goalTokens) if (skillTokens.has(t)) score += 1;
    if (score > 0) scored.push({ name: entry.name, body: body.trim(), score });
  }
  scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return scored.slice(0, MAX_SKILL_BODIES).map((s) => ({ name: s.name, body: s.body }));
}

/** Gather every compiler source group for one task (spec §5.1 order). */
export async function gatherSources(kern: Kernloop, task: TaskContract): Promise<BriefSources> {
  const facts = kern.memory.recallFacts(task.goal);
  const summaries = kern.memory.listSummaries({ limit: 5 });
  return {
    claims: gatherClaims(kern.paths.repoRoot),
    semanticFacts: facts.map((f) => ({
      fact: f.fact,
      provenance: f.provenance,
      ...(f.confidence === null ? {} : { confidence: f.confidence }),
      refreshedAt: new Date(f.refreshedAt).toISOString(),
    })),
    episodicSummaries: summaries.map((s) => ({
      taskId: s.taskId,
      summary: s.summary,
      traceRef: s.traceRef,
    })),
    repoProbes: await gatherRepoProbes(kern.paths.repoRoot),
    skillsIndex: gatherSkillsIndex(kern.paths.repoRoot),
    skillBodies: gatherSkillBodies(kern.paths.repoRoot, task.goal),
  };
}

/**
 * Fraction of the brief token budget that injected skill bodies may occupy (#228
 * P3·1). Bodies are valuable but SECONDARY: capping them ≤40% guarantees they can
 * never crowd out task/claims/facts even on a sparse brief, on top of being the
 * lowest-priority section (dropped first). A documented knob, not a magic number.
 */
const SKILL_BODIES_BUDGET_FRACTION = 0.4;

/**
 * Gather sources, compile the Brief under the overlay's token budget, and
 * publish it on the bus (audited at the publish boundary, rule 7). Used by
 * both the `brief` tool (dry-run, spec §3.4) and the `run` executor for
 * `brief.compile`.
 */
export async function assembleBrief(kern: Kernloop, task: TaskContract): Promise<Brief> {
  const sources = await gatherSources(kern, task);
  const brief = compileBrief({
    task,
    sources,
    budget: {
      totalTokens: kern.config.briefTokens,
      // Cap injected skill bodies so they never dominate the brief (#228 P3·1).
      perSection: {
        skillBodies: Math.floor(kern.config.briefTokens * SKILL_BODIES_BUDGET_FRACTION),
      },
    },
  });
  await kern.bus.publish('Brief', brief);
  return brief;
}
