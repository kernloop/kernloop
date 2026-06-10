import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createObserver,
  InvalidIssueProposalError,
  ObserverTrackerUnavailableError,
  type IssueExec,
  type IssueProposalInput,
  type Observer,
} from './index.js';
import { defaultGhExec, spawnCapture } from './issues.js';

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-observer-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function observerWithTicker(): Observer {
  let now = 1000;
  return createObserver(path.join(tmpDir(), 'overlay.sqlite'), { clock: () => ++now });
}

function makeProposalInput(overrides: Partial<IssueProposalInput> = {}): IssueProposalInput {
  return {
    title: 'observer: review-gate precision is drifting',
    body: 'Running precision for voter codex fell below 0.6 over the last 20 labeled votes.',
    taskShaped: {
      goal: 'Investigate the review-gate voter codex precision drop and recalibrate the eval set',
      constraints: ['do not change the gate tier', 'evidence threshold stays windowN=20'],
    },
    ...overrides,
  };
}

/**
 * A REAL fake-gh subprocess (no mock): a node script that asserts the argv
 * shape `gh issue create --title … --body …`, captures what it received to
 * `capturePath`, and prints an issue URL — or misbehaves on demand.
 */
function fakeGh(behavior: 'ok' | 'unauthed' | 'no-url'): { exec: IssueExec; capturePath: string } {
  const dir = tmpDir();
  const capturePath = path.join(dir, 'capture.json');
  const script = path.join(dir, 'fake-gh.mjs');
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(args));
if (${JSON.stringify(behavior)} === 'unauthed') {
  process.stderr.write('gh: To get started with GitHub CLI, please run: gh auth login\\n');
  process.exit(4);
}
if (args[0] !== 'issue' || args[1] !== 'create') { process.stderr.write('unexpected subcommand\\n'); process.exit(2); }
if (args[2] !== '--title' || args[4] !== '--body' || args.length !== 6) { process.stderr.write('unexpected flags\\n'); process.exit(2); }
if (${JSON.stringify(behavior)} === 'no-url') { process.stdout.write('Creating issue...\\n'); process.exit(0); }
process.stdout.write('https://github.com/kernloop/kernloop/issues/123\\n');
`,
  );
  const exec: IssueExec = (args) => spawnCapture(process.execPath, [script, ...args]);
  return { exec, capturePath };
}

describe('self-issue proposals (CLM-0056)', () => {
  it('persists a proposal at suggest tier with status proposed', () => {
    const observer = observerWithTicker();
    const proposal = observer.proposeIssue(makeProposalInput());
    expect(proposal).toMatchObject({
      id: 1,
      tier: 'suggest',
      status: 'proposed',
      url: undefined,
      createdAt: 1001,
      taskShaped: makeProposalInput().taskShaped,
    });
    expect(observer.getIssue(1)).toEqual(proposal);
    expect(observer.listIssues()).toEqual([proposal]);
    observer.close();
  });

  it('rejects a malformed proposal at the boundary', () => {
    const observer = observerWithTicker();
    expect(() => observer.proposeIssue(makeProposalInput({ title: '' }))).toThrow(
      InvalidIssueProposalError,
    );
    expect(observer.listIssues()).toEqual([]);
    observer.close();
  });

  it('treats SQL-injection-shaped titles and goals as ordinary data', () => {
    const observer = observerWithTicker();
    const hostile = "t'; DROP TABLE observer_issues;--";
    const proposal = observer.proposeIssue(
      makeProposalInput({ title: hostile, taskShaped: { goal: hostile } }),
    );
    expect(observer.getIssue(proposal.id)?.title).toBe(hostile);
    expect(observer.listIssues()).toHaveLength(1);
    observer.close();
  });
});

describe('filing via gh (CLM-0056)', () => {
  it('persists a proposal at suggest tier and files it through a real gh subprocess, storing the issue url', async () => {
    const observer = observerWithTicker();
    const { exec, capturePath } = fakeGh('ok');
    const proposal = observer.proposeIssue(makeProposalInput());
    const filed = await observer.fileIssue(proposal, { exec });
    expect(filed.status).toBe('filed');
    expect(filed.url).toBe('https://github.com/kernloop/kernloop/issues/123');
    expect(filed.filedAt).toBe(1002);
    expect(observer.getIssue(proposal.id)?.status).toBe('filed');

    // The subprocess really received gh-shaped argv, and the body carries the
    // ordinary task-shaped payload that re-enters through `run`.
    const argv = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as string[];
    expect(argv.slice(0, 3)).toEqual(['issue', 'create', '--title']);
    expect(argv[3]).toBe(proposal.title);
    expect(argv[5]).toContain(proposal.body);
    expect(argv[5]).toContain('"goal"');
    expect(argv[5]).toContain('feed this to `run` as an ordinary goal');
    observer.close();
  });

  it('throws ObserverTrackerUnavailableError when gh is absent', async () => {
    const observer = observerWithTicker();
    const proposal = observer.proposeIssue(makeProposalInput());
    // A real spawn of a binary that cannot exist — the default-exec code path.
    const exec: IssueExec = (args) => spawnCapture('kernloop-definitely-no-such-gh', args);
    await expect(observer.fileIssue(proposal, { exec })).rejects.toThrow(
      ObserverTrackerUnavailableError,
    );
    // Never a silent skip: the proposal stays honestly unfiled.
    expect(observer.getIssue(proposal.id)?.status).toBe('proposed');
    observer.close();
  });

  it('throws ObserverTrackerUnavailableError when gh exits nonzero (unauthenticated)', async () => {
    const observer = observerWithTicker();
    const { exec } = fakeGh('unauthed');
    const proposal = observer.proposeIssue(makeProposalInput());
    await expect(observer.fileIssue(proposal, { exec })).rejects.toThrow(
      ObserverTrackerUnavailableError,
    );
    await expect(observer.fileIssue(proposal, { exec })).rejects.toThrow(/auth login/);
    expect(observer.getIssue(proposal.id)?.status).toBe('proposed');
    observer.close();
  });

  it('throws ObserverTrackerUnavailableError when gh succeeds without printing a URL', async () => {
    const observer = observerWithTicker();
    const { exec } = fakeGh('no-url');
    const proposal = observer.proposeIssue(makeProposalInput());
    await expect(observer.fileIssue(proposal, { exec })).rejects.toThrow(
      ObserverTrackerUnavailableError,
    );
    observer.close();
  });

  it('default executor reports spawn failure or exit status as data, never throws', async () => {
    // Read-only probe of whatever `gh` is (or is not) on PATH: either a real
    // version exit or a spawn error captured as data — both are valid shapes.
    const result = await defaultGhExec(['--version']);
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
    expect(result.exitCode === null || typeof result.exitCode === 'number').toBe(true);
  });

  it('rejects filing an unknown or already-filed proposal', async () => {
    const observer = observerWithTicker();
    const { exec } = fakeGh('ok');
    const proposal = observer.proposeIssue(makeProposalInput());
    const filed = await observer.fileIssue(proposal, { exec });
    await expect(observer.fileIssue(filed, { exec })).rejects.toThrow(InvalidIssueProposalError);
    await expect(observer.fileIssue({ ...proposal, id: 99 }, { exec })).rejects.toThrow(
      InvalidIssueProposalError,
    );
    observer.close();
  });
});
