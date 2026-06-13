/**
 * The `editBody` write op security + behavior tests (CLM-0093, CLM-0106). Like
 * the rest of the provider suite, each drives a MOCK exec and asserts the exact
 * `gh` args-array, proving editBody routes the body through a temp file (never an
 * inline `--body`), reuses the allowlisted `gh issue edit` subcommand, binds the
 * ref to the configured repo, and returns errors as data — the same posture as
 * the other writes. Split into its own file to keep provider.test.ts ≤400 lines.
 */
import { describe, expect, it } from 'vitest';
import { githubProvider, type ExecResult, type TrackerExec } from './index.js';

const CONFIG = { repo: 'kernloop/kernloop' } as const;

/** A mock exec that records every (command, argv) call and replies success. */
function recordingExec(): {
  exec: TrackerExec;
  calls: Array<{ command: string; argv: readonly string[] }>;
} {
  const calls: Array<{ command: string; argv: readonly string[] }> = [];
  const exec: TrackerExec = (command, argv) => {
    calls.push({ command, argv });
    return Promise.resolve<ExecResult>({
      exitCode: 0,
      stdout: 'https://github.com/kernloop/kernloop/issues/42',
      stderr: '',
    });
  };
  return { exec, calls };
}

describe('githubProvider — editBody write op', () => {
  it('editBody builds gh issue edit --body-file (never --body), ref behind --', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).editBody(
      '#7',
      '## Sub-issues\n- [ ] #8',
    );
    expect(res).toMatchObject({ ok: true });
    const argv = calls[0]!.argv;
    expect(argv.slice(0, 2)).toEqual(['issue', 'edit']);
    expect(argv).toContain('--body-file');
    expect(argv).not.toContain('--body');
    // `#7` is normalized to the bare issue number reaching gh, the sole positional.
    expect(argv).toContain('--');
    expect(argv.at(-1)).toBe('7');
  });

  it('editBody binds a cross-repo URL ref to invalid-input and never spawns', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).editBody(
      'https://github.com/some-victim/private/issues/1',
      'pwned',
    );
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('editBody rejects an empty body at the boundary, never spawns', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).editBody('1', '');
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});
