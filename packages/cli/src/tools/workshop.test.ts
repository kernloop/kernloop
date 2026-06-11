/**
 * Unit tests for the `workshop` tools [CLM-0071, CLM-0072] with a SCRIPTED
 * docker double (an honest stand-in for the sandbox runtime — the real
 * sandboxed stdin/stdout contract and advisory-after-N promotion are proven
 * in faculty-toolsmith's run.docker.test.ts). Everything else is real: the
 * kernel assembly, tool resolution, ladder recording, the invocation audit
 * event, and the decay sweep.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { registerTool } from '@kernloop/faculty-toolsmith';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';
import { workshopListTool, workshopRunTool, workshopSweepTool } from './workshop.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-workshop-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshKernloop(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}

/** Hand-install a born fixture tool under the overlay workshop namespace. */
function installTool(kern: Kernloop, name: string, source: string, at = 1_000): void {
  const dir = path.join(kern.paths.dir, 'workshop', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'tool.mjs'), source, 'utf8');
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name: `workshop/${name}`,
      version: '0.1.0',
      kind: 'workshopTool',
      capabilities: [{ name: `${name}.run` }],
      contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
      cost: { tokens: 0, usd: 0, latencyMs: 100 },
      tier: 'suggest',
      claims: ['CLM-0071'],
      maturity: 'experimental',
    }),
    'utf8',
  );
  registerTool({ overlayDir: kern.paths.dir, name, at });
}

/** A scripted docker: prints `line` on stdout, exits with `code`. */
function scriptedDocker(repo: string, line: string, code: number): string {
  const file = path.join(repo, `docker-${code}`);
  writeFileSync(
    file,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(line)});\nprocess.exit(${code});\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

describe('workshopRunTool', () => {
  it('invokes a born tool, returns its parsed output, and audits the invocation', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    installTool(kern, 'echo', 'process.stdin.pipe(process.stdout);');
    const result = await workshopRunTool(
      kern,
      { name: 'echo', input: { x: 2 } },
      { dockerBin: scriptedDocker(repo, JSON.stringify({ y: 4 }), 0), now: () => 2_000 },
    );
    expect(result.clean).toBe(true);
    expect(result.output).toEqual({ y: 4 });
    expect(result.tier).toBe('suggest');
    // the invocation appended provenance — the spec §5.6 audit leg
    const invocation = readEnvelopes(kern.paths.audit).find(
      (e) => e.type === 'cli.workshop.invocation',
    );
    expect(invocation?.payload).toMatchObject({ name: 'echo', clean: true, exitCode: 0 });
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('an unclean run is reported (not thrown) and audited as unclean', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    installTool(kern, 'crasher', 'process.exit(1);');
    const result = await workshopRunTool(
      kern,
      { name: 'crasher', input: {} },
      { dockerBin: scriptedDocker(repo, 'boom', 1), now: () => 3_000 },
    );
    expect(result.clean).toBe(false);
    expect(result.output).toBeUndefined();
    const invocation = readEnvelopes(kern.paths.audit).find(
      (e) => e.type === 'cli.workshop.invocation',
    );
    expect(invocation?.payload).toMatchObject({ name: 'crasher', clean: false, exitCode: 1 });
    kern.close();
  });
});

describe('workshopSweepTool', () => {
  it('decays an unused tool and proposes its removal, auditing the sweep', () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    installTool(kern, 'stale', 'process.stdout.write("{}");', 1_000);
    // 31 days past the last use: one window → suggest stays, status flips to
    // removal_proposed (decayWindowDays default is 30).
    const now = 1_000 + 31 * 24 * 60 * 60 * 1_000;
    const result = workshopSweepTool(kern, { now: () => now });
    expect(result.removalProposed).toEqual(['stale']);
    const sweep = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.workshop.sweep');
    expect(sweep?.payload).toMatchObject({ count: 1, removalProposed: ['stale'] });
    kern.close();
  });

  it('a sweep with nothing to decay records no audit event', () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    installTool(kern, 'fresh', 'process.stdout.write("{}");', 1_000);
    const result = workshopSweepTool(kern, { now: () => 2_000 });
    expect(result.swept).toEqual([]);
    expect(readEnvelopes(kern.paths.audit).some((e) => e.type === 'cli.workshop.sweep')).toBe(
      false,
    );
    kern.close();
  });
});

describe('workshopListTool', () => {
  it('lists live tools with their ladder tier and clean-run count', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    installTool(kern, 'alpha', 'process.stdin.pipe(process.stdout);');
    await workshopRunTool(
      kern,
      { name: 'alpha', input: {} },
      { dockerBin: scriptedDocker(repo, '{}', 0), now: () => 2_000 },
    );
    const { tools } = workshopListTool(kern);
    expect(tools).toEqual([
      { name: 'alpha', version: '0.1.0', tier: 'suggest', status: 'live', cleanRuns: 1 },
    ]);
    kern.close();
  });
});
