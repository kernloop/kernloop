/**
 * Overlay data-portability commands: `memory export`/`import` (CLM-0069) and
 * `priors export` (CLM-0070). Exercised through the real CLI shell and the
 * tool functions over real overlays in temp directories.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import type { MemoryExport } from '@kernloop/faculty-memory';
import { runCli, type CliIo } from '../cli.js';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';
import { memoryExportTool, memoryImportTool } from './memory.js';
import { priorsExportTool } from './priors.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-portability-'));
  dirs.push(repo);
  return repo;
}
function freshKernloop(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Captured {
  io: CliIo;
  out: () => string;
  json: () => unknown;
}
function capture(cwd: string): Captured {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    io: { out: (t) => outLines.push(t), err: (t) => errLines.push(t), cwd },
    out: () => outLines.join('\n'),
    json: () => JSON.parse(outLines.join('\n')) as unknown,
  };
}

describe('memory export / import (CLM-0069)', () => {
  it('round-trips an overlay’s memory across repos via the CLI, loss-free', async () => {
    const source = repoDir();
    await runCli(['init'], capture(source).io);
    await runCli(
      ['remember', '--fact', 'router explores at epsilon 0.1', '--provenance', 'spec §3.2'],
      capture(source).io,
    );
    // export to stdout (no --out) — the document itself is the output
    const exp = capture(source);
    expect(await runCli(['memory', 'export'], exp.io)).toBe(0);
    const doc = exp.json() as MemoryExport;
    expect(doc.version).toBe('1');
    expect(doc.facts).toHaveLength(1);

    // write the export to a file, then import into a brand-new repo
    const file = path.join(source, 'mem.json');
    writeFileSync(file, JSON.stringify(doc), 'utf8');
    const target = repoDir();
    await runCli(['init'], capture(target).io);
    const imp = capture(target);
    expect(await runCli(['memory', 'import', file], imp.io)).toBe(0);
    expect(imp.json()).toMatchObject({ facts: 1, traces: 0 });

    // the imported overlay recalls the fact — intuition travelled
    const rec = capture(target);
    await runCli(['recall', '--query', 'router epsilon'], rec.io);
    expect(rec.out()).toContain('spec §3.2');
  });

  it('audits the import as cli.memory.import with counts', () => {
    const repo = repoDir();
    const src = freshKernloop(repo);
    src.memory.rememberFact({ fact: 'a durable fact', provenance: 'p' });
    const doc = memoryExportTool(src, {}) as MemoryExport;
    src.close();

    const target = repoDir();
    const file = path.join(target, 'mem.json');
    writeFileSync(file, JSON.stringify(doc), 'utf8');
    const kern = freshKernloop(target);
    memoryImportTool(kern, { file });
    kern.close();

    const events = readEnvelopes(path.join(target, '.kernloop', 'audit.jsonl'));
    const imported = events.filter((e) => e.type === 'cli.memory.import');
    expect(imported).toHaveLength(1);
    expect(imported[0]?.payload).toMatchObject({ facts: 1, traces: 0 });
  });

  it('writes the export to --out and returns a summary', () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    kern.memory.rememberFact({ fact: 'fact one', provenance: 'p' });
    const out = path.join(repo, 'export.json');
    const result = memoryExportTool(kern, { out });
    expect(result).toMatchObject({ written: out, facts: 1, traces: 0 });
    const onDisk = JSON.parse(readFileSync(out, 'utf8')) as MemoryExport;
    expect(onDisk.facts).toHaveLength(1);
    kern.close();
  });

  it('rejects a malformed import document at the boundary', () => {
    const repo = repoDir();
    const file = path.join(repo, 'bad.json');
    writeFileSync(file, JSON.stringify({ version: '2', facts: [], traces: [] }), 'utf8');
    const kern = freshKernloop(repo);
    expect(() => memoryImportTool(kern, { file })).toThrow();
    kern.close();
  });
});

describe('priors export (CLM-0070)', () => {
  it('writes reviewable priors.yaml from the fitness ledger via the CLI', async () => {
    const repo = repoDir();
    await runCli(['init'], capture(repo).io);
    // a real run ingests an Outcome into the observer ledger
    await runCli(
      ['run', '--goal', 'leave a fitness signal', '--capability', 'memory.episodic.read'],
      capture(repo).io,
    );
    const exp = capture(repo);
    expect(await runCli(['priors', 'export'], exp.io)).toBe(0);
    const result = exp.json() as { written: string; priors: number };
    expect(result.priors).toBeGreaterThan(0);

    const yamlText = readFileSync(path.join(repo, '.kernloop', 'priors.yaml'), 'utf8');
    expect(yamlText).toContain('# kernloop learned routing priors');
    const parsed = YAML.parse(yamlText) as { version: string; priors: Array<{ subject: string }> };
    expect(parsed.version).toBe('1');
    expect(parsed.priors.length).toBeGreaterThan(0);
    expect(typeof parsed.priors[0]?.subject).toBe('string');
  });

  it('exports an empty priors document when the ledger is empty', () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    const out = path.join(repo, 'priors.yaml');
    const result = priorsExportTool(kern, { out });
    expect(result).toEqual({ written: out, priors: 0 });
    const parsed = YAML.parse(readFileSync(out, 'utf8')) as { version: string; priors: unknown[] };
    expect(parsed).toEqual({ version: '1', priors: [] });
    kern.close();
  });

  it('honors --out for the priors export path', () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    kern.observer.ingestOutcome(
      {
        taskId: 't1',
        status: 'success',
        signals: [],
        cost: { tokens: 1, usd: 0 },
        traceRef: 'trace://t1',
        distillCandidates: [],
      },
      { subject: 'router-x' },
    );
    const out = path.join(repo, 'custom-priors.yaml');
    const result = priorsExportTool(kern, { out });
    expect(result.written).toBe(out);
    expect(readFileSync(out, 'utf8')).toContain('router-x');
    kern.close();
  });
});
