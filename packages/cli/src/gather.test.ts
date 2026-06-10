/**
 * Tests for brief-source gathering and the `brief` tool: real claims files,
 * real git probes, real memory reads — and a Brief published on the bus.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BriefSchema } from '@kernloop/contracts';
import { createKernloop, type Kernloop } from './kernel.js';
import { gatherClaims, gatherRepoProbes, gatherSkillsIndex } from './gather.js';
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
    // this package lives in a real git worktree — probe it
    const probes = await gatherRepoProbes(path.resolve(import.meta.dirname, '..'));
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
});
