/**
 * Real-docker proofs for the RUN path [CLM-0071, CLM-0072]: a born workshop
 * tool runs in the ratified sandbox against a stdin contract JSON, emits a
 * stdout contract JSON, and N=5 clean audited invocations move it from
 * `suggest` to `advisory` (the ladder rung earned through real use). These
 * run actual containers against node:22-alpine (pre-pulled once).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { N_CLEAN_RUNS_FOR_ADVISORY, loadLifecycle, registerTool } from './lifecycle.js';
import { RATIFIED_SANDBOX_PROFILE } from './profile.js';
import { runWorkshopTool } from './run.js';

// Probe synchronously at import time so describe.skipIf() gets an eager value.
// Catches ENOENT (binary absent in sandbox) and an unreachable daemon (non-zero exit).
const DOCKER_AVAILABLE = (() => {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
  return r.error === undefined && r.status === 0;
})();

const tmpDirs: string[] = [];
function overlay(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-run-docker-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * A stdin→stdout contract tool: read all of stdin as JSON, echo it back with
 * a `doubled` field. Dependency-free single-file node ES module — exactly the
 * runtime contract a born tool follows.
 */
const TRANSFORM_TOOL = [
  'const chunks = [];',
  'for await (const c of process.stdin) chunks.push(c);',
  'const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));',
  'process.stdout.write(JSON.stringify({ doubled: input.x * 2, echoed: input }));',
  '',
].join('\n');

/** Hand-install a born fixture tool (tool.mjs + a born lifecycle record). */
function installTool(overlayDir: string, name: string, source: string): void {
  const dir = path.join(overlayDir, 'workshop', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tool.mjs'), source, 'utf8');
  registerTool({ overlayDir, name, at: 1_000 });
}

describe.skipIf(!DOCKER_AVAILABLE)('runWorkshopTool (real docker)', () => {
  beforeAll(() => {
    execFileSync('docker', ['pull', RATIFIED_SANDBOX_PROFILE.image], { stdio: 'ignore' });
  });
  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });
  it('runs a born tool in the sandbox against a stdin contract and parses its stdout contract', async () => {
    const overlayDir = overlay();
    installTool(overlayDir, 'transform', TRANSFORM_TOOL);
    const result = await runWorkshopTool({
      overlayDir,
      name: 'transform',
      input: { x: 21 },
      now: 2_000,
    });
    expect(result.clean).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ doubled: 42, echoed: { x: 21 } });
    // the invocation advanced the decay clock and recorded a clean run
    const lifecycle = loadLifecycle(overlayDir);
    expect(lifecycle.tools['transform']?.cleanRuns).toBe(1);
    expect(lifecycle.tools['transform']?.lastUsedAt).toBe(2_000);
  });

  // N_CLEAN_RUNS_FOR_ADVISORY is 5; asserted against the constant below.
  it('promotes suggest → advisory after 5 clean audited invocations', async () => {
    expect(N_CLEAN_RUNS_FOR_ADVISORY).toBe(5);
    const overlayDir = overlay();
    installTool(overlayDir, 'ladder', TRANSFORM_TOOL);
    expect(loadLifecycle(overlayDir).tools['ladder']?.tier).toBe('suggest');
    let last;
    for (let i = 0; i < N_CLEAN_RUNS_FOR_ADVISORY; i++) {
      last = await runWorkshopTool({
        overlayDir,
        name: 'ladder',
        input: { x: i },
        now: 10_000 + i,
      });
      expect(last.clean).toBe(true);
    }
    // the Nth clean run earned the automatic promotion
    expect(last?.lifecycle.tier).toBe('advisory');
    const lifecycle = loadLifecycle(overlayDir);
    expect(lifecycle.tools['ladder']?.tier).toBe('advisory');
    const promotion = lifecycle.history.find((e) => e.event === 'promoted');
    expect(promotion).toMatchObject({ from: 'suggest', to: 'advisory', automatic: true });
  });

  it('a tool that emits non-JSON on stdout is an unclean run — no promotion credit', async () => {
    const overlayDir = overlay();
    installTool(overlayDir, 'noisy', 'process.stdout.write("plain text, not a contract");');
    const result = await runWorkshopTool({
      overlayDir,
      name: 'noisy',
      input: { x: 1 },
      now: 3_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.output).toBeUndefined();
    expect(loadLifecycle(overlayDir).tools['noisy']?.cleanRuns).toBe(0);
  });
});
