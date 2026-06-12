import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createObserver,
  InvalidIssueProposalError,
  type IssueProposalInput,
  type Observer,
} from './index.js';

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

describe('markIssueFiled (CLM-0056) — the PURE DB write the gated CLI calls', () => {
  it('marks a proposed row filed with the url + filedAt', () => {
    const observer = observerWithTicker();
    const proposal = observer.proposeIssue(makeProposalInput());
    const url = 'https://github.com/kernloop/kernloop/issues/123';
    const filed = observer.markIssueFiled(proposal.id, url);
    expect(filed.status).toBe('filed');
    expect(filed.url).toBe(url);
    expect(filed.filedAt).toBe(1002);
    expect(observer.getIssue(proposal.id)).toEqual(filed);
    observer.close();
  });

  it('rejects an unknown id', () => {
    const observer = observerWithTicker();
    expect(() =>
      observer.markIssueFiled(99, 'https://github.com/kernloop/kernloop/issues/1'),
    ).toThrow(InvalidIssueProposalError);
    observer.close();
  });

  it('rejects an already-filed row (idempotency guard, never a silent overwrite)', () => {
    const observer = observerWithTicker();
    const proposal = observer.proposeIssue(makeProposalInput());
    const url = 'https://github.com/kernloop/kernloop/issues/123';
    observer.markIssueFiled(proposal.id, url);
    expect(() => observer.markIssueFiled(proposal.id, url)).toThrow(InvalidIssueProposalError);
    observer.close();
  });

  it('rejects a non-https url (no garbage stored as the issue reference)', () => {
    const observer = observerWithTicker();
    const proposal = observer.proposeIssue(makeProposalInput());
    expect(() => observer.markIssueFiled(proposal.id, 'not-a-url')).toThrow(
      InvalidIssueProposalError,
    );
    expect(() => observer.markIssueFiled(proposal.id, '')).toThrow(InvalidIssueProposalError);
    expect(observer.getIssue(proposal.id)?.status).toBe('proposed');
    observer.close();
  });

  it('treats a malicious url/title as ordinary data — no injection (it is a pure parameterized write)', () => {
    const observer = observerWithTicker();
    const hostile = "t'; DROP TABLE observer_issues;--";
    const proposal = observer.proposeIssue(makeProposalInput({ title: hostile }));
    const hostileUrl = "https://example.com/1'; DROP TABLE observer_issues;--";
    const filed = observer.markIssueFiled(proposal.id, hostileUrl);
    expect(filed.url).toBe(hostileUrl);
    expect(filed.title).toBe(hostile);
    // The table still exists and the row is intact — bound parameters, no SQL.
    expect(observer.listIssues()).toHaveLength(1);
    observer.close();
  });
});
