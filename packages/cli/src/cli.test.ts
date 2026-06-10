/**
 * Tests for the `kernloop` CLI shell: command dispatch, JSON output, exit
 * codes, and flag validation — over real overlays in temp directories.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, type CliIo } from './cli.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-cli-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Captured {
  io: CliIo;
  out: () => string;
  err: () => string;
  json: () => unknown;
}

function capture(cwd: string): Captured {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    io: { out: (t) => outLines.push(t), err: (t) => errLines.push(t), cwd },
    out: () => outLines.join('\n'),
    err: () => errLines.join('\n'),
    json: () => JSON.parse(outLines.join('\n')) as unknown,
  };
}

describe('kernloop CLI', () => {
  it('init scaffolds the overlay and doctor then passes', async () => {
    const repo = repoDir();
    const init = capture(repo);
    expect(await runCli(['init'], init.io)).toBe(0);
    expect(init.json()).toMatchObject({ overlayDir: path.join(repo, '.kernloop') });
    const doc = capture(repo);
    expect(await runCli(['doctor'], doc.io)).toBe(0);
    expect(doc.json()).toMatchObject({ ok: true });
  });

  it('doctor exits 1 on a repo with no overlay', async () => {
    const c = capture(repoDir());
    expect(await runCli(['doctor'], c.io)).toBe(1);
    expect(c.json()).toMatchObject({ ok: false });
  });

  it('remember → recall → observe → audit work end to end as subcommands', async () => {
    const repo = repoDir();
    await runCli(['init'], capture(repo).io);
    const rem = capture(repo);
    expect(
      await runCli(
        ['remember', '--fact', 'cli is thin', '--provenance', 'AGENTS.md', '--confidence', '0.8'],
        rem.io,
      ),
    ).toBe(0);
    const rec = capture(repo);
    expect(await runCli(['recall', '--query', 'cli thin', '--limit', '5'], rec.io)).toBe(0);
    expect(rec.json()).toMatchObject({ facts: [{ provenance: 'AGENTS.md' }] });
    const obs = capture(repo);
    expect(await runCli(['observe'], obs.io)).toBe(0);
    expect(obs.json()).toMatchObject({ audit: { verified: true } });
    const aud = capture(repo);
    expect(await runCli(['audit'], aud.io)).toBe(0);
    expect(aud.json()).toMatchObject({ op: 'verify', result: { ok: true } });
    const query = capture(repo);
    expect(
      await runCli(['audit', '--op', 'query', '--type', 'kernel.registry.register'], query.io),
    ).toBe(0);
    expect((query.json() as { events: unknown[] }).events.length).toBeGreaterThan(0);
    const ranged = capture(repo);
    expect(await runCli(['audit', '--op', 'query', '--from', '1', '--to', '2'], ranged.io)).toBe(0);
    expect((ranged.json() as { events: unknown[] }).events.length).toBeLessThanOrEqual(2);
  });

  it('run --plan returns the routing decision as JSON', async () => {
    const repo = repoDir();
    const c = capture(repo);
    expect(
      await runCli(
        ['run', '--goal', 'plan only', '--capability', 'gate.quality', '--plan', '--id', 't-cli-1'],
        c.io,
      ),
    ).toBe(0);
    expect(c.json()).toMatchObject({
      kind: 'routing',
      decision: { selected: '@kernloop/faculty-gates@0.1.0' },
    });
  });

  it('status reports not-found as JSON', async () => {
    const c = capture(repoDir());
    expect(await runCli(['status', '--task-id', 'nope'], c.io)).toBe(0);
    expect(c.json()).toEqual({ found: false, taskId: 'nope' });
  });

  it('brief compiles a Brief from the CLI', async () => {
    const c = capture(repoDir());
    expect(await runCli(['brief', '--goal', 'compile me', '--id', 't-cli-brief'], c.io)).toBe(0);
    expect(c.json()).toMatchObject({ taskId: 't-cli-brief', compilerVersion: '0.1.0' });
  });

  it('manifest list/get/register work from the CLI', async () => {
    const repo = repoDir();
    const list = capture(repo);
    expect(await runCli(['manifest', '--op', 'list'], list.io)).toBe(0);
    expect((list.json() as { manifests: unknown[] }).manifests).toHaveLength(3);
    const get = capture(repo);
    expect(
      await runCli(['manifest', '--op', 'get', '--name', '@kernloop/faculty-memory'], get.io),
    ).toBe(0);
    expect(get.json()).toMatchObject({ found: true });
    const file = path.join(repo, 'manifest.json');
    writeFileSync(
      file,
      JSON.stringify({
        name: 'cli-extra',
        version: '0.0.1',
        kind: 'skill',
        capabilities: [],
        contracts: { consumes: [], emits: [] },
        cost: { tokens: 0, usd: 0, latencyMs: 1 },
        tier: 'suggest',
        claims: [],
        maturity: 'experimental',
      }),
    );
    const reg = capture(repo);
    expect(await runCli(['manifest', '--op', 'register', '--file', file], reg.io)).toBe(0);
    expect(reg.json()).toMatchObject({ op: 'register', registered: { name: 'cli-extra' } });
    const bad = capture(repo);
    expect(await runCli(['manifest', '--op', 'bogus'], bad.io)).toBe(1);
    expect(bad.err()).toContain('unknown manifest op');
  });

  it('gate rejects unknown gates with exit 1 and a typed error', async () => {
    const repo = repoDir();
    const c = capture(repo);
    expect(
      await runCli(['gate', '--task-id', 't', '--workspace', repo, '--gate', 'vote'], c.io),
    ).toBe(1);
    expect(c.err()).toContain('UnknownGateError');
  });

  it('fails loudly on missing required flags, unknown flags, and unknown commands', async () => {
    const repo = repoDir();
    const missing = capture(repo);
    expect(await runCli(['run', '--capability', 'gate.quality'], missing.io)).toBe(1);
    expect(missing.err()).toContain('--goal');
    const unknownFlag = capture(repo);
    expect(await runCli(['observe', '--bogus'], unknownFlag.io)).toBe(1);
    const unknownCmd = capture(repo);
    expect(await runCli(['frobnicate'], unknownCmd.io)).toBe(1);
    expect(unknownCmd.err()).toContain('unknown command');
  });

  it('prints usage for help and for a bare invocation', async () => {
    const help = capture(repoDir());
    expect(await runCli(['help'], help.io)).toBe(0);
    expect(help.out()).toContain('usage: kernloop');
    const bare = capture(repoDir());
    expect(await runCli([], bare.io)).toBe(1);
    expect(bare.out()).toContain('usage: kernloop');
  });
});
