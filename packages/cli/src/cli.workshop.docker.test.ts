/**
 * Real-docker end-to-end proof for `kernloop workshop run` [CLM-0071]: a born
 * tool, invoked through the CLI shell, runs in the ratified sandbox against a
 * stdin contract JSON, emits a stdout contract JSON the CLI prints, and the
 * invocation is audited. Runs an actual container (node:22-alpine, pre-pulled).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATIFIED_SANDBOX_PROFILE, registerTool } from '@kernloop/faculty-toolsmith';
import { runCli, type CliIo } from './cli.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-workshop-docker-'));
  dirs.push(repo);
  return repo;
}

interface Captured {
  io: CliIo;
  json: () => unknown;
  out: () => string;
}
function capture(cwd: string): Captured {
  const lines: string[] = [];
  return {
    io: { out: (t) => lines.push(t), err: (t) => lines.push(t), cwd },
    json: () => JSON.parse(lines.join('\n')) as unknown,
    out: () => lines.join('\n'),
  };
}

/** A stdin→stdout contract tool: echo input back with a `doubled` field. */
const TOOL = [
  'const chunks = [];',
  'for await (const c of process.stdin) chunks.push(c);',
  'const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));',
  'process.stdout.write(JSON.stringify({ doubled: input.x * 2 }));',
  '',
].join('\n');

beforeAll(() => {
  execFileSync('docker', ['pull', RATIFIED_SANDBOX_PROFILE.image], { stdio: 'ignore' });
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('kernloop workshop run (real docker)', () => {
  it('invokes a born tool through the CLI and prints its stdout contract', async () => {
    const repo = repoDir();
    await runCli(['init'], capture(repo).io);
    const overlayDir = path.join(repo, '.kernloop');
    const dir = path.join(overlayDir, 'workshop', 'doubler');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tool.mjs'), TOOL, 'utf8');
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        name: 'workshop/doubler',
        version: '0.1.0',
        kind: 'workshopTool',
        capabilities: [{ name: 'doubler.run' }],
        contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
        cost: { tokens: 0, usd: 0, latencyMs: 100 },
        tier: 'suggest',
        claims: ['CLM-0071'],
        maturity: 'experimental',
      }),
      'utf8',
    );
    registerTool({ overlayDir, name: 'doubler', at: 1_000 });

    const run = capture(repo);
    const code = await runCli(['workshop', 'run', 'doubler', '--input-json', '{"x":21}'], run.io);
    expect(code).toBe(0);
    expect(run.json()).toMatchObject({
      name: 'doubler',
      clean: true,
      exitCode: 0,
      output: { doubled: 42 },
    });

    // the invocation was audited (spec §5.6 invocation provenance leg)
    const audit = capture(repo);
    expect(
      await runCli(['audit', '--op', 'query', '--type', 'cli.workshop.invocation'], audit.io),
    ).toBe(0);
    expect(audit.out()).toContain('"name": "doubler"');
    expect(audit.out()).toContain('"clean": true');
  });
});
