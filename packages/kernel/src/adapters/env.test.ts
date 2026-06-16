/**
 * Least-privilege child-env acceptance tests (CLM-0122, #227). The pure
 * filtering is asserted directly; the end-to-end leak guard runs a REAL
 * subprocess — a fake `ollama` CLI that echoes its received environment — to
 * prove a host secret in the parent env never reaches a spawned model CLI,
 * while the benign base vars and the caller's declared extras do.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAFE_ENV_KEYS, droppedEnvKeys, scopedChildEnv } from './env.js';
import { invokeAdapter } from './invoke.js';

describe('scopedChildEnv (CLM-0122)', () => {
  it('keeps the benign base allowlist and drops everything else', () => {
    const out = scopedChildEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      TERM: 'xterm',
      ANTHROPIC_API_KEY: 'sk-secret',
      GH_TOKEN: 'ghp-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
    });
    expect(out).toEqual({ PATH: '/usr/bin', HOME: '/home/u', TERM: 'xterm' });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.GH_TOKEN).toBeUndefined();
  });

  it('keeps LC_* locale categories by prefix', () => {
    const out = scopedChildEnv({ LC_ALL: 'C', LC_TIME: 'en_US.UTF-8', LCD_PANEL: 'nope' });
    expect(out).toEqual({ LC_ALL: 'C', LC_TIME: 'en_US.UTF-8' });
    expect(out.LCD_PANEL).toBeUndefined();
  });

  it('passes through caller-named extras (the adapterEnvAllow escape hatch)', () => {
    const out = scopedChildEnv(
      { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-keep', OPENAI_API_KEY: 'sk-drop' },
      ['ANTHROPIC_API_KEY'],
    );
    expect(out.ANTHROPIC_API_KEY).toBe('sk-keep');
    expect(out.OPENAI_API_KEY).toBeUndefined();
  });

  it('drops undefined values even when the name is on the allowlist', () => {
    const out = scopedChildEnv({ PATH: '/usr/bin', HOME: undefined });
    expect(out).toEqual({ PATH: '/usr/bin' });
    expect('HOME' in out).toBe(false);
  });

  it('SAFE_ENV_KEYS names PATH and HOME but no credential-shaped var', () => {
    expect(SAFE_ENV_KEYS).toContain('PATH');
    expect(SAFE_ENV_KEYS).toContain('HOME');
    expect(SAFE_ENV_KEYS.some((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k))).toBe(false);
  });
});

describe('droppedEnvKeys (audit support)', () => {
  it('returns the withheld names, sorted, excluding the allowlist', () => {
    const dropped = droppedEnvKeys(
      { PATH: '/usr/bin', GH_TOKEN: 'x', ANTHROPIC_API_KEY: 'y', LC_ALL: 'C' },
      ['ANTHROPIC_API_KEY'],
    );
    expect(dropped).toEqual(['GH_TOKEN']);
  });

  it('counts a leak surface even when nothing is allowed', () => {
    expect(droppedEnvKeys({ PATH: '/usr/bin', SECRET_A: '1', SECRET_B: '2' })).toEqual([
      'SECRET_A',
      'SECRET_B',
    ]);
  });
});

describe('invokeAdapter scopes the spawned CLI env end-to-end (#227)', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kernloop-env-')));
  beforeAll(() => {
    // A fake `ollama` whose plain-text output echoes three env vars: a host
    // secret (must be empty in the child), a benign base var, and an extra.
    const script =
      '#!/bin/sh\n' +
      'printf "SECRET[%s] HOME[%s] EXTRA[%s]\\n" "$SECRET_SENTINEL" "$HOME" "$MY_ALLOWED_KEY"\n' +
      'exit 0\n';
    writeFileSync(join(dir, 'ollama'), script, { mode: 0o755 });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const parentEnv = {
    PATH: dir,
    HOME: '/home/scoped',
    SECRET_SENTINEL: 'leaked-provider-key',
    MY_ALLOWED_KEY: 'explicitly-allowed',
  };

  it('withholds a host secret from the child while keeping base vars', async () => {
    const result = await invokeAdapter('ollama', {
      prompt: 'hi',
      model: 'llama3',
      timeoutMs: 10_000,
      env: parentEnv,
    });
    expect(result.output).toContain('HOME[/home/scoped]');
    expect(result.output).toContain('SECRET[]'); // the secret never reached the child
    expect(result.output).toContain('EXTRA[]'); // not on the allowlist by default
  });

  it('passes an allowed extra through when named in envAllow', async () => {
    const result = await invokeAdapter('ollama', {
      prompt: 'hi',
      model: 'llama3',
      timeoutMs: 10_000,
      env: parentEnv,
      envAllow: ['MY_ALLOWED_KEY'],
    });
    expect(result.output).toContain('EXTRA[explicitly-allowed]');
    expect(result.output).toContain('SECRET[]'); // still withheld — only the named extra passes
  });
});
