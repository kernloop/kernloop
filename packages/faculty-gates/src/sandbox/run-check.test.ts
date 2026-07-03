/**
 * Sandboxed-check unit tests (#236) — no real Docker. The command translation
 * (pnpm/yarn → npm run, + node_modules/.bin on PATH), the FAIL-CLOSED functional
 * probe (missing binary → unusable), and the TOCTOU mapping (docker vanishes
 * mid-run → a spawnError, never a silent unsandboxed pass).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubprocessCheck } from '../checks.js';
import { containerArgv, dockerUsable, runCheckInSandbox } from './run-check.js';

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const check = (command: string, args: string[]): SubprocessCheck => ({
  name: 't',
  command,
  args,
  parse: () => [],
});

describe('containerArgv — offline command translation (#236)', () => {
  it('translates pnpm/yarn <script> → npm run <script>', () => {
    expect(containerArgv(check('pnpm', ['test']))).toEqual([
      'sh',
      '-c',
      'PATH="/work/.kernloop-pm/bin:/work/node_modules/.bin:$PATH" exec "$0" "$@"',
      'npm',
      'run',
      'test',
    ]);
    expect(containerArgv(check('yarn', ['typecheck']))).toEqual([
      'sh',
      '-c',
      'PATH="/work/.kernloop-pm/bin:/work/node_modules/.bin:$PATH" exec "$0" "$@"',
      'npm',
      'run',
      'typecheck',
    ]);
  });

  it('passes non-PM commands through (still PATH-wrapped, injection-safe argv)', () => {
    expect(containerArgv(check('tsc', ['--noEmit']))).toEqual([
      'sh',
      '-c',
      'PATH="/work/.kernloop-pm/bin:/work/node_modules/.bin:$PATH" exec "$0" "$@"',
      'tsc',
      '--noEmit',
    ]);
  });
});

describe('dockerUsable — fail-closed functional probe (#236)', () => {
  it('returns false when the docker binary is absent (no silent fallback to usable)', async () => {
    const missing = join(tmp('kernloop-nodocker-'), 'docker');
    expect(await dockerUsable(missing)).toBe(false);
  });
});

describe('runCheckInSandbox — TOCTOU fail-closed (#236)', () => {
  it('maps a missing/unavailable docker to a spawnError, never a silent pass', async () => {
    const ws = tmp('kernloop-ws-');
    writeFileSync(join(ws, 'index.ts'), 'export const x = 1;\n');
    const missing = join(tmp('kernloop-nodocker-'), 'docker');
    const exec = await runCheckInSandbox(check('npm', ['test']), ws, missing);
    expect(exec.exitCode).toBeNull();
    expect(exec.spawnError).toMatch(/sandbox unavailable/i);
  });
});
