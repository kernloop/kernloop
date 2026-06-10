import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workshop = path.join(repoRoot, '.kernloop/workshop/loc-probe');
const skill = path.join(repoRoot, 'skills/run-quality-gate-via-kernel');

// CLM-0057: a distilled skill and a forged workshop tool both born through
// gates. These assertions hold against the committed artifacts of the live
// P3 exit runs (eval evidence: evals/p3-exit/, .kernloop/workshop/,
// skills/run-quality-gate-via-kernel/).
describe('forged workshop tool (born through forge gates)', () => {
  test('loc-probe carries its full birth certificate', () => {
    for (const f of ['tool.mjs', 'test.mjs', 'manifest.json', 'claim.yaml']) {
      expect(fs.existsSync(path.join(workshop, f)), f).toBe(true);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(workshop, 'manifest.json'), 'utf8'));
    expect(manifest.name).toBe('workshop/loc-probe');
    expect(manifest.kind).toBe('workshopTool');
    expect(manifest.tier).toBe('suggest');
    const claim = parseYaml(fs.readFileSync(path.join(workshop, 'claim.yaml'), 'utf8'));
    expect(claim.id).toBe('WS-0001');
  });

  test('lifecycle records loc-probe born at suggest', () => {
    const lifecycle = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.kernloop/workshop/lifecycle.json'), 'utf8'),
    );
    const entry = lifecycle.tools['loc-probe'];
    expect(entry.tier).toBe('suggest');
    expect(entry.status).toBe('live');
  });

  test('the model-generated tool still passes its acceptance test', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-p3-proof-'));
    fs.copyFileSync(path.join(workshop, 'tool.mjs'), path.join(dir, 'tool.mjs'));
    fs.copyFileSync(path.join(workshop, 'test.mjs'), path.join(dir, 'test.mjs'));
    const out = execFileSync(process.execPath, ['--test', 'test.mjs'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out).toContain('# pass 2');
    expect(out).toContain('# fail 0');
  });
});

describe('distilled skill (born through the distill ratification path)', () => {
  test('the skill is live with its proposal provenance intact', () => {
    expect(fs.existsSync(path.join(skill, 'SKILL.md'))).toBe(true);
    const proposal = parseYaml(fs.readFileSync(path.join(skill, 'PROPOSAL.yaml'), 'utf8'));
    expect(proposal.name).toBe('run-quality-gate-via-kernel');
    expect(proposal.tier).toBe('suggest');
    expect(proposal.sourceTrace).toBe('task-c785a478-0cce-4df9-894e-7c1408dcee1e');
  });

  test('the committed exit audit chain contains the birth events', () => {
    const lines = fs
      .readFileSync(path.join(repoRoot, 'evals/p3-exit/audit.jsonl'), 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    const types = new Set(lines.map((e) => e.type));
    expect(types.has('cli.distill.proposed')).toBe(true);
    expect(types.has('cli.forge.build')).toBe(true);
    expect(types.has('governance.ratification.vote')).toBe(true);
  });
});
