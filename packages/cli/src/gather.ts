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
  };
}

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
    budget: { totalTokens: kern.config.briefTokens },
  });
  await kern.bus.publish('Brief', brief);
  return brief;
}
