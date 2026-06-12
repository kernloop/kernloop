/**
 * The default exec is a real spawn with NO shell (CLM-0093). These tests run
 * a harmless real subprocess to prove the args-array form: a value containing
 * shell metacharacters reaches the program as a literal argument, because
 * there is no shell to interpret it.
 */
import { describe, expect, it } from 'vitest';
import { defaultExec, spawnCapture } from './exec.js';
import { scrub } from './github.js';

describe('spawnCapture — no shell, args as literals', () => {
  it('passes an arg with shell metacharacters through verbatim (no shell expansion)', async () => {
    // `node -e` echoes argv[1]; a shell would have expanded `$(...)` / `;`.
    const dangerous = '$(touch /tmp/should-not-exist); echo hi';
    const res = await spawnCapture(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      dangerous,
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(dangerous);
  });

  it('passes a leading-dash arg as a literal argument, not a flag', async () => {
    const res = await spawnCapture(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1] ?? "MISSING")',
      '--',
      '--not-a-real-flag',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('--not-a-real-flag');
  });

  it('never throws on a missing command — returns spawnError as data', async () => {
    const res = await spawnCapture('definitely-not-a-real-binary-xyz', ['arg']);
    expect(res.exitCode).toBeNull();
    expect(res.spawnError).toBeDefined();
  });

  it('defaultExec delegates to spawnCapture', async () => {
    const res = await defaultExec(process.execPath, ['-e', 'process.stdout.write("ok")']);
    expect(res.stdout).toBe('ok');
  });
});

describe('scrub — strips secrets and paths from surfaced output', () => {
  it('redacts a token-shaped value', () => {
    expect(scrub('failed: token=ghp_abc123')).toContain('token=[redacted]');
    expect(scrub('failed: token=ghp_abc123')).not.toContain('ghp_abc123');
  });

  it('collapses an absolute path', () => {
    expect(scrub('wrote /home/user/secret/body.md')).toContain('[path]');
  });

  it('bounds the length to 500 chars', () => {
    expect(scrub('x'.repeat(2000)).length).toBe(500);
  });
});
