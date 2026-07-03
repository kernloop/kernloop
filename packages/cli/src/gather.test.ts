/**
 * Tests for brief-source gathering and the `brief` tool: real claims files,
 * real git probes, real memory reads — and a Brief published on the bus.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BriefSchema } from '@kernloop/contracts';
import { createKernloop, type Kernloop } from './kernel.js';
import {
  gatherClaims,
  gatherRepoProbes,
  gatherSkillBodies,
  gatherSkillsIndex,
  gatherWorkshopIndex,
} from './gather.js';
import { briefTool } from './tools/brief.js';
import { readEnvelopes } from './tools/audit.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-gather-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshKernloop(repo = repoDir()): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}

describe('gatherClaims', () => {
  it('reads claims-registry entries and skips unreadable files', () => {
    const repo = repoDir();
    mkdirSync(path.join(repo, 'claims', 'registry'), { recursive: true });
    writeFileSync(
      path.join(repo, 'claims', 'registry', 'CLM-0001.yaml'),
      'id: CLM-0001\nstatement: a real claim\nstatus: verified\n',
    );
    writeFileSync(path.join(repo, 'claims', 'registry', 'broken.yaml'), '{[not yaml');
    writeFileSync(path.join(repo, 'claims', 'registry', 'partial.yaml'), 'id: CLM-0002\n');
    expect(gatherClaims(repo)).toEqual([
      { id: 'CLM-0001', statement: 'a real claim', status: 'verified' },
    ]);
  });

  it('returns nothing for a repo with no claims registry', () => {
    expect(gatherClaims(repoDir())).toEqual([]);
  });
});

describe('gatherRepoProbes', () => {
  it('returns no probes outside a git repository rather than inventing state', async () => {
    expect(await gatherRepoProbes(repoDir())).toEqual([]);
  });

  it('probes a real git repository with status and log', async () => {
    // Construct a throwaway git repo so the test is self-contained and runs
    // everywhere git exists (host AND in-sandbox) without relying on the
    // ambient worktree (which is absent in the gate sandbox — no .git).
    const repo = repoDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@kernloop.test',
        'commit',
        '--allow-empty',
        '-m',
        'init',
      ],
      { cwd: repo, stdio: 'ignore' },
    );
    const probes = await gatherRepoProbes(repo);
    const names = probes.map((p) => p.name);
    expect(names).toContain('git-status');
    expect(names).toContain('git-log');
    const log = probes.find((p) => p.name === 'git-log');
    expect(log?.content.length).toBeGreaterThan(0);
    expect(log?.source).toBe('git log --oneline -5');
  });
});

describe('gatherSkillsIndex', () => {
  it('indexes skills/<name>/SKILL.md as name + one-liner only', () => {
    const repo = repoDir();
    mkdirSync(path.join(repo, 'skills', 'demo-skill'), { recursive: true });
    writeFileSync(
      path.join(repo, 'skills', 'demo-skill', 'SKILL.md'),
      '# demo-skill\n\nA one-line description of the skill.\n\nLong body follows.\n',
    );
    mkdirSync(path.join(repo, 'skills', 'no-skill-md'), { recursive: true });
    expect(gatherSkillsIndex(repo)).toEqual([
      { name: 'demo-skill', oneLiner: 'A one-line description of the skill.' },
    ]);
  });

  it('returns an empty index when the library is empty', () => {
    expect(gatherSkillsIndex(repoDir())).toEqual([]);
  });

  it('excludes skills/proposed from the index so only the committed library is served', () => {
    const repo = repoDir();
    mkdirSync(path.join(repo, 'skills', 'live-skill'), { recursive: true });
    writeFileSync(
      path.join(repo, 'skills', 'live-skill', 'SKILL.md'),
      '# live-skill\n\nA ratified, committed skill.\n',
    );
    mkdirSync(path.join(repo, 'skills', 'proposed', 'pending-skill'), { recursive: true });
    writeFileSync(
      path.join(repo, 'skills', 'proposed', 'pending-skill', 'SKILL.md'),
      '# pending-skill\n\nAn unratified distill proposal.\n',
    );
    // even a stray SKILL.md directly under proposed/ stays out of the index
    writeFileSync(path.join(repo, 'skills', 'proposed', 'SKILL.md'), '# stray\n\nNot a skill.\n');
    expect(gatherSkillsIndex(repo)).toEqual([
      { name: 'live-skill', oneLiner: 'A ratified, committed skill.' },
    ]);
  });
});

describe('gatherSkillBodies (#228 P3·1, CLM-0139)', () => {
  /** Write a live (or proposed/) skill with a one-liner + a body, return repo. */
  function withSkill(
    repo: string,
    name: string,
    oneLiner: string,
    body: string,
    proposed = false,
  ): void {
    const base = proposed
      ? path.join(repo, 'skills', 'proposed', name)
      : path.join(repo, 'skills', name);
    mkdirSync(base, { recursive: true });
    writeFileSync(path.join(base, 'SKILL.md'), `# ${name}\n\n${oneLiner}\n\n${body}\n`);
  }

  it('injects the BODY of a live skill whose name/one-liner overlaps the goal', () => {
    const repo = repoDir();
    withSkill(repo, 'release-flow', 'cut a release safely', 'Step 1: tag\nStep 2: publish');
    const bodies = gatherSkillBodies(repo, 'help me cut a release');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.name).toBe('release-flow');
    expect(bodies[0]?.body).toContain('Step 1: tag'); // the FULL procedure, not the one-liner
  });

  it('NEVER injects a skills/proposed body — only ratified content (CLM-0050)', () => {
    const repo = repoDir();
    withSkill(repo, 'pending-release', 'cut a release safely', 'Step: do it', true);
    expect(gatherSkillBodies(repo, 'cut a release')).toEqual([]);
  });

  it('excludes a skill with no real token overlap (lexical relevance gate)', () => {
    const repo = repoDir();
    withSkill(repo, 'release-flow', 'cut a release safely', 'body');
    // "add a feature" is all stop-words → no signal token → no match.
    expect(gatherSkillBodies(repo, 'add a feature')).toEqual([]);
    // A goal sharing no meaningful token with the skill is also excluded.
    expect(gatherSkillBodies(repo, 'refactor the parser internals')).toEqual([]);
  });

  it('ranks by overlap count, tie-breaks by name (deterministic), caps at 3', () => {
    const repo = repoDir();
    withSkill(repo, 'release-deploy', 'release and deploy the service', 'b'); // release+deploy+service = 3
    withSkill(repo, 'deploy-only', 'deploy the service', 'b'); // deploy+service = 2
    withSkill(repo, 'aaa-release', 'release', 'b'); // release = 1 (wins the name tie-break)
    withSkill(repo, 'release-notes', 'release notes only', 'b'); // release = 1 (dropped by the cap of 3)
    const bodies = gatherSkillBodies(repo, 'release and deploy the service now');
    // score desc, then name asc; the cap drops the 4th (release-notes, the score-1 loser by name).
    expect(bodies.map((b) => b.name)).toEqual(['release-deploy', 'deploy-only', 'aaa-release']);
    // Deterministic: a second call on the same repo+goal yields the identical order.
    expect(
      gatherSkillBodies(repo, 'release and deploy the service now').map((b) => b.name),
    ).toEqual(bodies.map((b) => b.name));
  });

  it('is empty when there is no skills/ dir or the goal has no signal tokens', () => {
    expect(gatherSkillBodies(repoDir(), 'cut a release')).toEqual([]); // no skills dir
    const repo = repoDir();
    withSkill(repo, 'release-flow', 'cut a release safely', 'body');
    expect(gatherSkillBodies(repo, 'the a an to of')).toEqual([]); // all stop-words
  });
});

/** Install a workshop tool fixture (manifest + a lifecycle entry) under `overlay`. */
function withWorkshopTool(
  overlay: string,
  name: string,
  tier: 'suggest' | 'advisory' | 'enforce',
  status: 'live' | 'removal_proposed',
  description: string,
): void {
  const dir = path.join(overlay, 'workshop', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name: `workshop/${name}`,
      version: '0.1.0',
      kind: 'workshopTool',
      capabilities: [{ name: `workshop.${name}`, description }],
      tier,
      claims: [],
      maturity: 'experimental',
    }),
  );
  const lcPath = path.join(overlay, 'workshop', 'lifecycle.json');
  const lc = existsSync(lcPath)
    ? (JSON.parse(readFileSync(lcPath, 'utf8')) as { tools: Record<string, unknown>; history: [] })
    : { tools: {}, history: [] };
  lc.tools[name] = { name, tier, cleanRuns: 3, lastUsedAt: 1, born: 1, status };
  writeFileSync(lcPath, JSON.stringify(lc));
}

describe('gatherWorkshopIndex (#228 P3·3, CLM-0141)', () => {
  it('surfaces ADVISORY and ENFORCE live tools as hints (name + description + tier), name-sorted', () => {
    const overlay = repoDir();
    withWorkshopTool(overlay, 'zzz-advisory', 'advisory', 'live', 'last by name');
    withWorkshopTool(overlay, 'aaa-advisory', 'advisory', 'live', 'count LOC');
    withWorkshopTool(overlay, 'enforced', 'enforce', 'live', 'an enforced tool');
    const index = gatherWorkshopIndex(overlay);
    expect(index).toEqual([
      { name: 'aaa-advisory', description: 'count LOC', tier: 'advisory' },
      { name: 'enforced', description: 'an enforced tool', tier: 'enforce' },
      { name: 'zzz-advisory', description: 'last by name', tier: 'advisory' },
    ]);
  });

  it('NEVER surfaces a born/decayed suggest tool (advisory+ only — unproven excluded)', () => {
    const overlay = repoDir();
    withWorkshopTool(overlay, 'born', 'suggest', 'live', 'just forged');
    expect(gatherWorkshopIndex(overlay)).toEqual([]);
  });

  it('excludes a removal_proposed (decayed-out) tool even at advisory tier (respect decay)', () => {
    const overlay = repoDir();
    withWorkshopTool(overlay, 'going-away', 'advisory', 'removal_proposed', 'on the way out');
    expect(gatherWorkshopIndex(overlay)).toEqual([]);
  });

  it('is empty for an overlay with no workshop tools', () => {
    expect(gatherWorkshopIndex(repoDir())).toEqual([]);
  });
});

describe('briefTool', () => {
  it('compiles a zod-valid Brief from real gathered sources without executing, and publishes it', async () => {
    const repo = repoDir();
    mkdirSync(path.join(repo, 'claims', 'registry'), { recursive: true });
    writeFileSync(
      path.join(repo, 'claims', 'registry', 'CLM-0099.yaml'),
      'id: CLM-0099\nstatement: brief sources are real\nstatus: verified\n',
    );
    const kern = freshKernloop(repo);
    kern.memory.rememberFact({ fact: 'briefs cite their sources', provenance: 'spec §5.1' });
    const brief = await briefTool(kern, { goal: 'briefs cite sources', id: 'task-brief-1' });
    expect(BriefSchema.safeParse(brief).success).toBe(true);
    expect(brief.taskId).toBe('task-brief-1');
    const sectionNames = brief.sections.map((s) => s.name);
    expect(sectionNames).toContain('task');
    expect(sectionNames).toContain('claims');
    expect(sectionNames).toContain('semanticFacts');
    const claimsSection = brief.sections.find((s) => s.name === 'claims');
    expect(claimsSection?.content).toContain('CLM-0099');
    const published = readEnvelopes(kern.paths.audit).find(
      (e) =>
        e.type === 'kernel.bus.publish' && (e.payload as { contract: string }).contract === 'Brief',
    );
    expect((published?.payload as { messageId: string }).messageId).toBe('task-brief-1');
    // dry-run: nothing executed, nothing recorded to episodic memory
    expect(kern.memory.getTraceSummary('task-brief-1')).toBeUndefined();
    kern.close();
  });

  it('injects a relevant live skill BODY into the compiled brief, end to end (#228 P3·1)', async () => {
    const repo = repoDir();
    mkdirSync(path.join(repo, 'skills', 'greet-guide'), { recursive: true });
    writeFileSync(
      path.join(repo, 'skills', 'greet-guide', 'SKILL.md'),
      '# greet-guide\n\nhow to write a greet feature\n\nStep 1: export greet(name)\nStep 2: return a hello string\n',
    );
    const kern = freshKernloop(repo);
    const brief = await briefTool(kern, { goal: 'add a greet feature', id: 'task-skillbody' });
    const section = brief.sections.find((s) => s.name === 'skillBodies');
    expect(section, 'a relevant live skill must contribute a skillBodies section').toBeDefined();
    // The FULL procedure reached the brief — not merely the one-liner the index carries.
    expect(section?.content).toContain('Step 1: export greet(name)');
    expect(section?.provenance.some((p) => p.ref === 'skill:greet-guide:body')).toBe(true);
    // The cheap index still lists it too (the body is the addition, not a replacement).
    expect(brief.sections.find((s) => s.name === 'skillsIndex')?.content).toContain('greet-guide');
    kern.close();
  });

  it('surfaces an advisory workshop tool into the brief as a run-hint, never an MCP tool (#228 P3·3)', async () => {
    const repo = repoDir();
    withWorkshopTool(
      path.join(repo, '.kernloop'),
      'loc-probe',
      'advisory',
      'live',
      'count non-blank LOC',
    );
    const kern = freshKernloop(repo);
    const mcpToolCount = kern.registry.list().length; // the kernel eleven, unchanged below
    const brief = await briefTool(kern, { goal: 'measure the codebase', id: 'task-workshop' });
    const section = brief.sections.find((s) => s.name === 'workshopIndex');
    expect(section, 'an advisory workshop tool must surface a workshopIndex hint').toBeDefined();
    expect(section?.content).toContain('kernloop workshop run loc-probe'); // the documented CLI target
    expect(section?.provenance.some((p) => p.ref === 'workshop:loc-probe')).toBe(true);
    // Surfacing is a HINT only: the registry (router candidates) gained no tool.
    expect(kern.registry.list()).toHaveLength(mcpToolCount);
    kern.close();
  });
});
