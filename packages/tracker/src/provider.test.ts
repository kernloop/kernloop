/**
 * The GitHub TrackerProvider security + behavior suite (CLM-0093). Each test
 * drives the provider through a MOCK exec and asserts the exact `gh` args-array
 * it builds, so the security posture is proven by construction, not prose.
 */
import { describe, expect, it } from 'vitest';
import { GH_SUBCOMMANDS, githubProvider, type ExecResult, type TrackerExec } from './index.js';

const CONFIG = { repo: 'kernloop/kernloop' } as const;

/** A mock exec that records every (command, argv) call and replies success. */
function recordingExec(stdout = 'https://github.com/kernloop/kernloop/issues/42'): {
  exec: TrackerExec;
  calls: Array<{ command: string; argv: readonly string[] }>;
} {
  const calls: Array<{ command: string; argv: readonly string[] }> = [];
  const exec: TrackerExec = (command, argv) => {
    calls.push({ command, argv });
    return Promise.resolve<ExecResult>({ exitCode: 0, stdout, stderr: '' });
  };
  return { exec, calls };
}

/** An exec that fails the test if it is ever invoked (dry-run must not spawn). */
const neverExec: TrackerExec = () => {
  throw new Error('exec was called — a dry-run must spawn nothing');
};

describe('githubProvider — capability descriptor', () => {
  it('declares every core op supported (honest descriptor)', () => {
    const caps = githubProvider(CONFIG, 'execute', recordingExec().exec).capabilities();
    expect(caps).toEqual({
      createIssue: true,
      closeIssue: true,
      comment: true,
      addLabels: true,
      editBody: true,
      getIssue: true,
    });
  });

  it('the capability descriptor includes the getIssue READ op', () => {
    const caps = githubProvider(CONFIG, 'execute', recordingExec().exec).capabilities();
    expect(caps.getIssue).toBe(true);
  });
});

describe('githubProvider — getIssue READ op (hardened gh issue view)', () => {
  /** A mock exec that records calls and replies with the given view JSON on stdout. */
  function viewExec(stdout: string): {
    exec: TrackerExec;
    calls: Array<{ command: string; argv: readonly string[] }>;
  } {
    const calls: Array<{ command: string; argv: readonly string[] }> = [];
    const exec: TrackerExec = (command, argv) => {
      calls.push({ command, argv });
      return Promise.resolve<ExecResult>({ exitCode: 0, stdout, stderr: '' });
    };
    return { exec, calls };
  }

  it('builds gh issue view --repo o/n --json number,state -- 42 and parses CLOSED', async () => {
    const { exec, calls } = viewExec('{"number":42,"state":"CLOSED"}');
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('42');
    expect(res).toEqual({ ok: true, state: 'closed', ref: '42' });
    expect(calls).toHaveLength(1);
    const { command, argv } = calls[0]!;
    expect(command).toBe('gh');
    expect(argv.slice(0, 2)).toEqual(['issue', 'view']);
    expect(argv).toContain('--repo');
    expect(argv).toContain('kernloop/kernloop');
    // The --json field list is the HARD-CODED allowlist, never widened.
    const j = argv.indexOf('--json');
    expect(j).toBeGreaterThan(-1);
    expect(argv[j + 1]).toBe('number,state');
    // The ref is the sole positional behind `--`.
    expect(argv).toContain('--');
    expect(argv.at(-1)).toBe('42');
  });

  it('parses OPEN to the lowercase open state', async () => {
    const { exec } = viewExec('{"number":7,"state":"OPEN"}');
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('7');
    expect(res).toEqual({ ok: true, state: 'open', ref: '7' });
  });

  it('ALWAYS reads even in dry-run mode (a read is not a mutation, mode-independent)', async () => {
    const { exec, calls } = viewExec('{"number":9,"state":"CLOSED"}');
    const res = await githubProvider(CONFIG, 'dry-run', exec).getIssue('9');
    expect(res).toEqual({ ok: true, state: 'closed', ref: '9' });
    expect(calls).toHaveLength(1); // dry-run did NOT skip the read
  });

  it('rejects a CROSS-REPO github URL ref — invalid-input, never spawns', async () => {
    const { exec, calls } = viewExec('{"number":1,"state":"OPEN"}');
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue(
      'https://github.com/some-victim/private/issues/1',
    );
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('surfaces a nonzero gh exit (issue not found) as a scrubbed, typed failure', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({
        exitCode: 1,
        stdout: '',
        stderr: 'could not find issue; token=ghp_supersecret',
      });
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('999');
    expect(res).toMatchObject({ ok: false, reason: 'exit-nonzero' });
    if (!res.ok) expect(res.message).not.toContain('ghp_supersecret');
  });

  it('surfaces malformed JSON stdout as a typed parse-failed (never throws)', async () => {
    const { exec } = viewExec('not json at all');
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('42');
    expect(res).toMatchObject({ ok: false, reason: 'parse-failed' });
  });

  it('surfaces an unexpected state value as parse-failed', async () => {
    const { exec } = viewExec('{"number":42,"state":"PENDING"}');
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('42');
    expect(res).toMatchObject({ ok: false, reason: 'parse-failed' });
  });

  it('surfaces a spawn failure as a typed spawn-failed', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({ exitCode: null, stdout: '', stderr: '', spawnError: 'ENOENT' });
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('1');
    expect(res).toMatchObject({ ok: false, reason: 'spawn-failed' });
  });

  it('surfaces an output overflow as a typed io-failed (read op)', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({ exitCode: null, stdout: '', stderr: '', outputOverflow: true });
    const res = await githubProvider(CONFIG, 'execute', exec).getIssue('1');
    expect(res).toMatchObject({ ok: false, reason: 'io-failed' });
  });
});

describe('githubProvider — execute mode builds the right gh args', () => {
  it('createIssue builds gh issue create with --title= and a --body-file, repo from config', async () => {
    const { exec, calls } = recordingExec();
    const provider = githubProvider(CONFIG, 'execute', exec);
    const res = await provider.createIssue({ title: 'Fix the bug', body: 'details here' });
    expect(res).toEqual({ ok: true, ref: 'https://github.com/kernloop/kernloop/issues/42' });
    expect(calls).toHaveLength(1);
    const { command, argv } = calls[0]!;
    expect(command).toBe('gh');
    expect(argv.slice(0, 2)).toEqual(['issue', 'create']);
    expect(argv).toContain('--repo');
    expect(argv).toContain('kernloop/kernloop');
    expect(argv).toContain('--title=Fix the bug');
    // The body is routed through a temp file, never inlined as --body <text>.
    const bf = argv.indexOf('--body-file');
    expect(bf).toBeGreaterThan(-1);
    expect(argv).not.toContain('--body');
    expect(argv[bf + 1]).toMatch(/kernloop-tracker-/);
  });

  it('closeIssue builds gh issue close with the ref after a -- separator', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).closeIssue('42', 'completed');
    expect(res.ok).toBe(true);
    const argv = calls[0]!.argv;
    expect(argv.slice(0, 2)).toEqual(['issue', 'close']);
    // The reason rides in the `=` form (allowlisted), never a bare flag+value pair.
    expect(argv).toContain('--reason=completed');
    // The ref is positional, guarded behind `--`.
    expect(argv).toContain('--');
    expect(argv.at(-1)).toBe('42');
    expect(argv.indexOf('--')).toBeLessThan(argv.length - 1);
  });

  it('comment routes the body through a --body-file, ref behind --', async () => {
    const { exec, calls } = recordingExec();
    await githubProvider(CONFIG, 'execute', exec).comment('#7', 'looks good');
    const argv = calls[0]!.argv;
    expect(argv.slice(0, 2)).toEqual(['issue', 'comment']);
    expect(argv).toContain('--body-file');
    expect(argv).not.toContain('--body');
    // `#7` is normalized to the bare issue number reaching gh.
    expect(argv.at(-1)).toBe('7');
  });

  it('addLabels builds gh issue edit with --add-label= per label, ref behind --', async () => {
    const { exec, calls } = recordingExec();
    await githubProvider(CONFIG, 'execute', exec).addLabels('42', ['security', 'review-finding']);
    const argv = calls[0]!.argv;
    expect(argv.slice(0, 2)).toEqual(['issue', 'edit']);
    expect(argv).toContain('--add-label=security');
    expect(argv).toContain('--add-label=review-finding');
    expect(argv.at(-1)).toBe('42');
  });
});

describe('githubProvider — flag-injection defense', () => {
  it('a body starting with - is written to a file, never passed as an arg that could be a flag', async () => {
    const { exec, calls } = recordingExec();
    const provider = githubProvider(CONFIG, 'execute', exec);
    await provider.createIssue({ title: 'safe title', body: '--yes\n-rf evil' });
    const argv = calls[0]!.argv;
    // The dangerous body text appears NOWHERE in argv — it lives in the temp file.
    expect(argv.join(' ')).not.toContain('--yes');
    expect(argv.join(' ')).not.toContain('-rf evil');
  });

  it('a title starting with - is bound via --title= so it cannot be read as a flag', async () => {
    const { exec, calls } = recordingExec();
    await githubProvider(CONFIG, 'execute', exec).createIssue({
      title: '--repo evil/repo',
      body: 'b',
    });
    const argv = calls[0]!.argv;
    // The value rides inside a single `--title=...` token; there is no bare
    // `--repo evil/repo` pair injected, and only the config repo is present.
    expect(argv).toContain('--title=--repo evil/repo');
    expect(argv.filter((a) => a === '--repo')).toHaveLength(1);
    expect(argv).not.toContain('evil/repo');
  });

  it('rejects a label outside the safe charset (no leading -, no shell metachars)', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).addLabels('42', ['-rf']);
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0); // never reached the exec
  });

  it('rejects an issue ref that is not a number or URL (no flag smuggling via ref)', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).closeIssue('--repo evil');
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});

describe('githubProvider — issue ref is bound to the configured repo', () => {
  it('accepts a same-repo github.com URL and passes gh the bare NUMBER, never the URL', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).closeIssue(
      'https://github.com/kernloop/kernloop/issues/7',
    );
    expect(res.ok).toBe(true);
    const argv = calls[0]!.argv;
    expect(argv.at(-1)).toBe('7'); // the number, not the URL
    expect(argv.join(' ')).not.toContain('https://');
  });

  it('rejects a CROSS-REPO github URL — no cross-repo action, never spawns', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).closeIssue(
      'https://github.com/some-victim/private/issues/1',
    );
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('rejects a non-github host URL — no SSRF to an arbitrary host, never spawns', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).comment(
      'https://attacker.example/collect/9',
      'hi',
    );
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});

describe('githubProvider — close reason is allowlisted', () => {
  it('accepts only completed / not planned; rejects anything else without spawning', async () => {
    const { exec, calls } = recordingExec();
    const p = githubProvider(CONFIG, 'execute', exec);
    expect((await p.closeIssue('1', 'completed')).ok).toBe(true);
    expect((await p.closeIssue('1', 'not planned')).ok).toBe(true);
    const bad = await p.closeIssue('1', 'because-i-said-so');
    expect(bad).toMatchObject({ ok: false, reason: 'invalid-input' });
    // Two valid spawns; the bad reason never reached gh.
    expect(calls).toHaveLength(2);
  });
});

describe('githubProvider — body size is bounded', () => {
  it('rejects an oversize create body at the boundary, never spawns', async () => {
    const { exec, calls } = recordingExec();
    const huge = 'x'.repeat(65_536 + 1);
    const res = await githubProvider(CONFIG, 'execute', exec).createIssue({
      title: 't',
      body: huge,
    });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('rejects an oversize comment body at the boundary, never spawns', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).comment('1', 'y'.repeat(65_537));
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});

describe('githubProvider — subcommand allowlist', () => {
  it('every op builds only an allowlisted gh issue subcommand', async () => {
    const { exec, calls } = recordingExec();
    const p = githubProvider(CONFIG, 'execute', exec);
    await p.createIssue({ title: 't', body: 'b' });
    await p.closeIssue('1');
    await p.comment('1', 'c');
    await p.addLabels('1', ['x']);
    await p.editBody('1', 'b2');
    for (const { argv } of calls) {
      expect(argv[0]).toBe('issue');
      expect(GH_SUBCOMMANDS).toContain(argv[1]);
    }
  });
});

describe('githubProvider — dry-run spawns nothing', () => {
  it('createIssue in dry-run never calls the exec and records a proposal', async () => {
    const provider = githubProvider(CONFIG, 'dry-run', neverExec);
    const res = await provider.createIssue({ title: 'hello', body: 'world' });
    expect(res).toEqual({ ok: true, ref: 'dry-run://no-mutation' });
    expect(provider.proposals).toHaveLength(1);
    const proposal = provider.proposals[0]!;
    expect(proposal.op).toBe('createIssue');
    expect(proposal.command).toBe('gh');
    expect(proposal.argv).toContain('--title=hello');
    expect(proposal.bodyViaFile).toBe(true);
    // The proposal shows a placeholder path, never a real temp file.
    expect(proposal.argv).toContain('<tmpfile>');
  });

  it('all five mutating ops in dry-run spawn nothing', async () => {
    const p = githubProvider(CONFIG, 'dry-run', neverExec);
    await p.createIssue({ title: 't', body: 'b' });
    await p.closeIssue('1');
    await p.comment('1', 'c');
    await p.addLabels('1', ['x']);
    await p.editBody('1', 'b2');
    expect(p.proposals).toHaveLength(5);
  });
});

describe('githubProvider — config validation + errors as data', () => {
  it('rejects a malformed repo at construction', () => {
    expect(() => githubProvider({ repo: 'not a repo' }, 'dry-run')).toThrow();
  });

  it('surfaces a nonzero gh exit as a scrubbed, typed failure (never throws)', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'gh: token=ghp_supersecret rejected' });
    const res = await githubProvider(CONFIG, 'execute', exec).createIssue({
      title: 't',
      body: 'b',
    });
    expect(res).toMatchObject({ ok: false, reason: 'exit-nonzero' });
    if (!res.ok) expect(res.message).not.toContain('ghp_supersecret');
  });

  it('turns an unexpected throw (e.g. a failed body-file write) into a typed io-failed, never propagates', async () => {
    const throwingExec: TrackerExec = () => {
      throw new Error('boom: fs write failed');
    };
    const res = await githubProvider(CONFIG, 'execute', throwingExec).comment('1', 'hi');
    expect(res).toMatchObject({ ok: false, reason: 'io-failed' });
  });

  it('surfaces an output overflow as a typed io-failed (write op)', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({ exitCode: null, stdout: '', stderr: '', outputOverflow: true });
    const res = await githubProvider(CONFIG, 'execute', exec).createIssue({
      title: 't',
      body: 'b',
    });
    expect(res).toMatchObject({ ok: false, reason: 'io-failed' });
  });

  it('surfaces a spawn failure as a typed failure', async () => {
    const exec: TrackerExec = () =>
      Promise.resolve({ exitCode: null, stdout: '', stderr: '', spawnError: 'ENOENT' });
    const res = await githubProvider(CONFIG, 'execute', exec).closeIssue('1');
    expect(res).toMatchObject({ ok: false, reason: 'spawn-failed' });
  });

  it('rejects an empty createIssue title at the boundary', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).createIssue({ title: '', body: 'b' });
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty comment body at the boundary', async () => {
    const { exec, calls } = recordingExec();
    const res = await githubProvider(CONFIG, 'execute', exec).comment('1', '');
    expect(res).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(calls).toHaveLength(0);
  });
});
