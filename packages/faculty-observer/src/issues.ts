/**
 * The self-issue seam (spec §5.5, CLM-0056): the Observer PROPOSES issues
 * about the system itself at `suggest` tier — persisting them as ordinary,
 * task-shaped payloads in its own `observer_issues` table — and NEVER acts
 * above `suggest`. This package holds NO subprocess and NO tracker seam: it
 * mutates nothing outside `observer_*`, files nothing, and spawns nothing.
 * Filing is a separate, human-ratified, enforce-tier-gated action routed
 * through the tracker by the `kernloop observer` CLI; {@link markIssueFiled}
 * is the PURE DB write that CLI calls once the tracker confirms a filing.
 * Self-filed issues re-enter through the same canonical `run` loop as user
 * work — there is no Observer→engine path anywhere in this faculty.
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { InvalidIssueProposalError } from './errors.js';

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
 * Mark a persisted proposal `filed` once an EXTERNAL actor (the tracker, via
 * the gated `kernloop observer file` CLI) has created the real issue
 * (CLM-0056). This is a PURE DB write — it spawns nothing, reaches no tracker,
 * and holds no `gh` seam; the faculty never acts above `suggest`, so the
 * acting edge lives entirely in the CLI/tracker. `url` is validated as a
 * non-empty `https?://` string and treated as ordinary data (a hostile url or
 * title is bound as a parameter, never interpolated). Throws
 * {@link InvalidIssueProposalError} when the id is unknown, the row is already
 * `filed`, or `url` is not an http(s) URL; otherwise returns the updated row.
 */
export function markIssueFiled(
  db: Database.Database,
  now: number,
  id: number,
  url: string,
): IssueProposal {
  const current = getIssue(db, id);
  if (current === undefined) {
    throw new InvalidIssueProposalError(`no proposal with id ${String(id)}`);
  }
  if (current.status === 'filed') {
    throw new InvalidIssueProposalError(`proposal ${String(id)} is already filed`);
  }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new InvalidIssueProposalError(
      `filed url must be a non-empty http(s) URL: ${String(url)}`,
    );
  }
  db.prepare("UPDATE observer_issues SET status = 'filed', url = ?, filedAt = ? WHERE id = ?").run(
    url,
    now,
    id,
  );
  return getIssue(db, id) as IssueProposal;
}
