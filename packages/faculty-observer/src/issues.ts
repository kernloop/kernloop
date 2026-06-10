/**
 * The self-issue path (spec §5.5, CLM-0056): the Observer files issues at
 * `suggest` tier — including issues about the system itself — into the
 * overlay repo's tracker via the `gh` CLI. The proposal carries an ordinary
 * task-shaped payload (goal + constraints) that a human or scheduler feeds
 * to `run`; self-filed issues re-enter through the same canonical loop as
 * user work. There is NO Observer→engine invocation anywhere in this
 * package — the Observer proposes, it never acts above `suggest`, and it
 * mutates nothing outside its own `observer_*` tables.
 */
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { InvalidIssueProposalError, ObserverTrackerUnavailableError } from './errors.js';

/** Boundary schema for {@link proposeIssue} input. */
const IssueProposalInputSchema = z.strictObject({
  title: z.string().min(1),
  body: z.string().min(1),
  taskShaped: z.strictObject({
    goal: z.string().min(1),
    constraints: z.array(z.string().min(1)).optional(),
  }),
});
export type IssueProposalInput = z.infer<typeof IssueProposalInputSchema>;

/** A persisted self-issue proposal (observer_issues row). */
export interface IssueProposal {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  /** The ordinary `run` payload a human or scheduler replays (CLM-0056). */
  readonly taskShaped: { readonly goal: string; readonly constraints: readonly string[] };
  /** Always `suggest` — the Observer never acts above it (spec §3.2, §5.5). */
  readonly tier: 'suggest';
  readonly status: 'proposed' | 'filed';
  /** Tracker URL once filed. */
  readonly url: string | undefined;
  readonly createdAt: number;
  readonly filedAt: number | undefined;
}

/** Captured result of one tracker-CLI invocation. */
export interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not even start (e.g. gh absent). */
  readonly spawnError?: string;
}

/** Injectable tracker executor; the default spawns the real `gh`. */
export type IssueExec = (args: readonly string[]) => Promise<ExecResult>;

/** Spawn `command args`, capture output; never throws — errors are data. */
export function spawnCapture(command: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) =>
      resolve({ exitCode: null, stdout, stderr, spawnError: error.message }),
    );
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/** The default executor: the real `gh` CLI on PATH. */
export const defaultGhExec: IssueExec = (args) => spawnCapture('gh', args);

interface IssueRow {
  id: number;
  title: string;
  body: string;
  goal: string;
  constraints: string;
  tier: string;
  status: string;
  url: string | null;
  createdAt: number;
  filedAt: number | null;
}

function toProposal(row: IssueRow): IssueProposal {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    taskShaped: { goal: row.goal, constraints: JSON.parse(row.constraints) as string[] },
    tier: 'suggest',
    status: row.status === 'filed' ? 'filed' : 'proposed',
    url: row.url ?? undefined,
    createdAt: row.createdAt,
    filedAt: row.filedAt ?? undefined,
  };
}

/**
 * Persist a self-issue proposal (CLM-0056): status `proposed`, tier
 * `suggest`, task-shaped payload stored as ordinary data. Nothing outside
 * `observer_issues` is touched.
 */
export function proposeIssue(
  db: Database.Database,
  now: number,
  input: IssueProposalInput,
): IssueProposal {
  const parsed = IssueProposalInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidIssueProposalError(`issue proposal rejected: ${parsed.error.message}`);
  }
  const { title, body, taskShaped } = parsed.data;
  const result = db
    .prepare(
      `INSERT INTO observer_issues (title, body, goal, constraints, tier, status, createdAt)
       VALUES (?, ?, ?, ?, 'suggest', 'proposed', ?)`,
    )
    .run(title, body, taskShaped.goal, JSON.stringify(taskShaped.constraints ?? []), now);
  return getIssue(db, Number(result.lastInsertRowid)) as IssueProposal;
}

/** One persisted proposal by id, or `undefined`. */
export function getIssue(db: Database.Database, id: number): IssueProposal | undefined {
  const row = db.prepare('SELECT * FROM observer_issues WHERE id = ?').get(id) as
    | IssueRow
    | undefined;
  return row === undefined ? undefined : toProposal(row);
}

/** All persisted proposals, newest first. */
export function listIssues(db: Database.Database): IssueProposal[] {
  const rows = db.prepare('SELECT * FROM observer_issues ORDER BY id DESC').all() as IssueRow[];
  return rows.map(toProposal);
}

/** The issue body actually filed: prose plus the replayable `run` payload. */
export function issueBody(proposal: IssueProposal): string {
  const payload = JSON.stringify(proposal.taskShaped, null, 2);
  return `${proposal.body}\n\n---\nTask-shaped payload — feed this to \`run\` as an ordinary goal (no privileged path):\n\n\`\`\`json\n${payload}\n\`\`\``;
}

/**
 * File a persisted proposal via `gh issue create` (CLM-0056). The executor
 * is injectable for tests; the default spawns the real `gh`. `gh` absent or
 * exiting nonzero (unauthenticated, no repo) throws
 * {@link ObserverTrackerUnavailableError} — never a silent skip, never a
 * stubbed success. On success the row gains the tracker URL and `filed`.
 */
export async function fileIssue(
  db: Database.Database,
  now: number,
  proposal: IssueProposal,
  exec: IssueExec = defaultGhExec,
): Promise<IssueProposal> {
  const current = getIssue(db, proposal.id);
  if (current === undefined) {
    throw new InvalidIssueProposalError(`no proposal with id ${String(proposal.id)}`);
  }
  if (current.status === 'filed') {
    throw new InvalidIssueProposalError(`proposal ${String(proposal.id)} is already filed`);
  }
  const result = await exec([
    'issue',
    'create',
    '--title',
    current.title,
    '--body',
    issueBody(current),
  ]);
  if (result.spawnError !== undefined) {
    throw new ObserverTrackerUnavailableError(
      `gh could not be started (is the GitHub CLI installed?): ${result.spawnError}`,
    );
  }
  if (result.exitCode !== 0) {
    throw new ObserverTrackerUnavailableError(
      `gh issue create exited ${String(result.exitCode)} (unauthenticated or no tracker?): ${result.stderr.trim()}`,
    );
  }
  const url = result.stdout.trim().split('\n').at(-1) ?? '';
  if (!/^https?:\/\//.test(url)) {
    throw new ObserverTrackerUnavailableError(
      `gh issue create succeeded but printed no issue URL: ${result.stdout.trim()}`,
    );
  }
  db.prepare("UPDATE observer_issues SET status = 'filed', url = ?, filedAt = ? WHERE id = ?").run(
    url,
    now,
    current.id,
  );
  return getIssue(db, current.id) as IssueProposal;
}
