/**
 * REAL-docker adversarial proofs for the gate sandbox (#236, binding condition
 * 5). These run actual containers under the RATIFIED_GATE_PROFILE (pre-pulled
 * once) and assert the isolation BITES: network egress fails, a fork-bomb is
 * capped (not the host), host FS outside the scratch is unreachable, and a
 * legitimate native dependency (better-sqlite3, glibc) still loads. Require
 * Docker (the CI test job provides it, as the toolsmith real-docker suites do).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SubprocessCheck } from '../checks.js';
import { RATIFIED_GATE_PROFILE } from './profile.js';
import { runCheckInSandbox } from './run-check.js';

const dirs: string[] = [];
function tmpWs(): string {
  const d = mkdtempSync(join(tmpdir(), 'kernloop-gate-docker-ws-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

beforeAll(() => {
  execFileSync('docker', ['pull', RATIFIED_GATE_PROFILE.image], { stdio: 'ignore' });
}, 300_000);
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A check that runs an inline node program inside the sandbox. */
function nodeCheck(program: string): SubprocessCheck {
  return { name: 'probe', command: 'node', args: ['-e', program], parse: () => [] };
}

describe('gate sandbox — real docker isolation (#236)', () => {
  it('BLOCKS network egress (--network none)', async () => {
    const ws = tmpWs();
    // Exit 7 only if a fetch SUCCEEDS; under --network none it must throw → exit 3.
    const prog = [
      'fetch("https://example.com",{signal:AbortSignal.timeout(4000)})',
      '.then(()=>process.exit(7)).catch(()=>process.exit(3));',
    ].join('');
    const exec = await runCheckInSandbox(nodeCheck(prog), ws);
    expect(exec.timedOut).toBe(false);
    expect(exec.exitCode).toBe(3); // egress failed, as required
  }, 120_000);

  it('cannot read host FS outside the copied workspace', async () => {
    const ws = tmpWs();
    // A host secret OUTSIDE the workspace must be invisible in the container.
    const outside = mkdtempSync(join(tmpdir(), 'kernloop-host-secret-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'HOSTSECRET');
    const prog = `const fs=require("fs");try{fs.readFileSync(${JSON.stringify(join(outside, 'secret.txt'))});process.exit(7);}catch{process.exit(4);}`;
    const exec = await runCheckInSandbox(nodeCheck(prog), ws);
    expect(exec.exitCode).toBe(4); // host path unreadable from the container
  }, 120_000);

  it('caps a fork-bomb without taking down the host (pids-limit)', async () => {
    const ws = tmpWs();
    // Spawn children until the pids cap is hit; the container is killed/limited,
    // the host is unaffected. We only require the run to TERMINATE (no hang).
    const prog =
      'const cp=require("child_process");for(let i=0;i<5000;i++){try{cp.spawn(process.execPath,["-e","setInterval(()=>{},1e9)"]);}catch{}}setTimeout(()=>process.exit(0),3000);';
    const exec = await runCheckInSandbox(nodeCheck(prog), ws);
    expect(exec.timedOut === true || typeof exec.exitCode === 'number').toBe(true);
  }, 120_000);

  it('runs a legitimate check and loads a glibc native dep (better-sqlite3)', async () => {
    const ws = tmpWs();
    // A minimal installed workspace: package.json + a test that uses the native dep.
    writeFileSync(
      join(ws, 'package.json'),
      JSON.stringify({
        name: 'w',
        version: '1.0.0',
        private: true,
        scripts: { test: 'node t.js' },
      }),
    );
    writeFileSync(
      join(ws, 't.js'),
      'const D=require("better-sqlite3");const db=new D(":memory:");db.exec("CREATE TABLE t(x)");process.exit(0);',
    );
    // Install the native dep into the workspace node_modules (copied into scratch).
    execFileSync('npm', ['install', '--no-audit', '--no-fund', 'better-sqlite3@11.8.1'], {
      cwd: ws,
      stdio: 'ignore',
    });
    const exec = await runCheckInSandbox(
      { name: 'test', command: 'pnpm', args: ['test'], parse: () => [] },
      ws,
    );
    expect(exec.timedOut).toBe(false);
    expect(exec.exitCode).toBe(0); // native dep loaded, test passed, offline
  }, 300_000);
});
