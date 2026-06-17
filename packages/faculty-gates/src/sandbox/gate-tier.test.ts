/**
 * Gate isolation-tier integration (#236) — runQualityGate's tier resolution
 * with a SCRIPTED docker (no real daemon): enforce + no Docker FAILS CLOSED (the
 * gate refuses, no check runs); enabled + no Docker + opt-out DEGRADES to the
 * env-scoped spawn with the reduced tier surfaced; enabled + Docker runs in the
 * sandbox and surfaces the docker tier. Proves tier-reported == tier-applied.
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubprocessCheck } from '../checks.js';
import { runQualityGate } from '../run.js';

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake `docker` that behaves like a daemon that ran the container and exited `code`. */
function scriptedDocker(code: number): string {
  const dir = tmp('kernloop-docker-');
  const p = join(dir, 'docker');
  writeFileSync(p, `#!/bin/sh\nexit ${String(code)}\n`, { mode: 0o755 });
  return p;
}

const noop: SubprocessCheck = { name: 'noop', command: 'true', args: [], parse: () => [] };

describe('runQualityGate sandbox tiers (#236)', () => {
  it('enforce + Docker unavailable → REFUSES (fail-closed), runs no check', async () => {
    const ws = tmp('kernloop-ws-');
    // A check that would write a marker IF it were spawned on the host.
    const marker = join(ws, 'RAN');
    const writeMarker: SubprocessCheck = {
      name: 'marker',
      command: 'sh',
      args: ['-c', `touch ${marker}`],
      parse: () => [],
    };
    const verdict = await runQualityGate({
      taskId: 't',
      workspaceDir: ws,
      checks: [writeMarker],
      sandbox: { enabled: true, enforce: true, dockerBin: join(tmp('x-'), 'no-docker') },
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => /refused to run generated checks/.test(f.message))).toBe(
      true,
    );
    expect(existsSync(marker)).toBe(false); // the check never ran
  });

  it('enabled + Docker unavailable + enforce:false → DEGRADES, surfaces reduced tier', async () => {
    const ws = tmp('kernloop-ws-');
    const verdict = await runQualityGate({
      taskId: 't',
      workspaceDir: ws,
      checks: [noop], // `true` on the host → exit 0
      sandbox: { enabled: true, enforce: false, dockerBin: join(tmp('x-'), 'no-docker') },
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.findings.some((f) => f.severity === 'warn' && /REDUCED/.test(f.message))).toBe(
      true,
    );
  });

  it('enabled + Docker usable → runs in the sandbox, surfaces the docker tier', async () => {
    const ws = tmp('kernloop-ws-');
    writeFileSync(join(ws, 'index.ts'), 'export const x = 1;\n');
    const verdict = await runQualityGate({
      taskId: 't',
      workspaceDir: ws,
      checks: [noop],
      sandbox: { enabled: true, enforce: true, dockerBin: scriptedDocker(0) },
    });
    expect(verdict.result).toBe('pass');
    expect(
      verdict.findings.some(
        (f) => f.severity === 'info' && /docker --network none/.test(f.message),
      ),
    ).toBe(true);
  });

  it('sandbox disabled → no tier finding (byte-identical legacy behavior)', async () => {
    const ws = tmp('kernloop-ws-');
    const verdict = await runQualityGate({
      taskId: 't',
      workspaceDir: ws,
      checks: [noop],
      sandbox: { enabled: false, enforce: true },
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.findings.some((f) => /sandbox/.test(f.message))).toBe(false);
  });
});
