/**
 * Real-docker proof tests for CLM-0052: the cage is real, not declared.
 * These run actual containers against node:22-alpine (pre-pulled once;
 * `docker pull` is idempotent). CI runners have docker.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATIFIED_SANDBOX_PROFILE, SandboxProfileSchema } from './profile.js';
import { runInSandbox } from './sandbox.js';

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-docker-test-'));
  tmpDirs.push(dir);
  return dir;
}

beforeAll(() => {
  execFileSync('docker', ['pull', RATIFIED_SANDBOX_PROFILE.image], { stdio: 'ignore' });
});
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runInSandbox (real docker)', () => {
  it('runs a command in the ratified sandbox and captures its output', async () => {
    const result = await runInSandbox({
      scratchDir: tmpDir(),
      command: ['node', '-e', 'console.log("sandbox-ok")'],
      profile: RATIFIED_SANDBOX_PROFILE,
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('sandbox-ok');
  });

  it('denies network inside the sandbox: fetch to example.com fails', async () => {
    const result = await runInSandbox({
      scratchDir: tmpDir(),
      command: [
        'node',
        '-e',
        "fetch('https://example.com').then(() => process.exit(0), () => process.exit(7))",
      ],
      profile: RATIFIED_SANDBOX_PROFILE,
    });
    expect(result.exitCode).toBe(7);
  });

  it('scopes the filesystem: host repo paths are not visible in the container', async () => {
    // This very repo exists on the host; inside the sandbox the same
    // absolute path must not exist — only /scratch and declared mounts do.
    const hostPath = path.resolve(import.meta.dirname, '..', '..', '..');
    expect(fs.existsSync(hostPath)).toBe(true);
    const result = await runInSandbox({
      scratchDir: tmpDir(),
      command: [
        'node',
        '-e',
        `process.exit(require('fs').existsSync(${JSON.stringify(hostPath)}) ? 9 : 0)`,
      ],
      profile: RATIFIED_SANDBOX_PROFILE,
    });
    expect(result.exitCode).toBe(0);
  });

  it('attaches declared mounts read-only: reads succeed, writes fail', async () => {
    const input = tmpDir();
    fs.writeFileSync(path.join(input, 'data.txt'), 'declared-input', 'utf8');
    const result = await runInSandbox({
      scratchDir: tmpDir(),
      command: [
        'node',
        '-e',
        "const fs=require('fs');" +
          "if(fs.readFileSync('/inputs/data.txt','utf8')!=='declared-input')process.exit(2);" +
          "try{fs.writeFileSync('/inputs/x','nope');process.exit(3)}catch{process.exit(0)}",
      ],
      mounts: [{ source: input, target: '/inputs' }],
      profile: RATIFIED_SANDBOX_PROFILE,
    });
    expect(result.exitCode).toBe(0);
  });

  it('kills the run at timeoutMs', async () => {
    const profile = SandboxProfileSchema.parse({ ...RATIFIED_SANDBOX_PROFILE, timeoutMs: 3000 });
    const started = Date.now();
    const result = await runInSandbox({
      scratchDir: tmpDir(),
      command: ['sleep', '60'],
      profile,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(30000);
  });
});
