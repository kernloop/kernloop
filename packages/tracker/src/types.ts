/**
 * Provider-agnostic issue-tracker contract (spec §5.5). The system SCORES,
 * SUGGESTS, and ASSEMBLES; an outward-facing mutation (filing/closing/
 * commenting on an issue in a real tracker) is the gated edge of that loop —
 * it runs only at the `enforce` authority tier and is human-ratified, NEVER
 * auto (spec §3.2 hard invariant). This module defines the SHAPE of that edge
 * so the Observer and a later faculty-scrum can both target it without
 * importing each other: one interface, many providers.
 *
 * Two honesty rules are baked into the types:
 *  - `TrackerMode = 'dry-run'` returns the would-be invocation WITHOUT acting
 *    (a proposal); a dry-run provider spawns nothing. `execute` performs it.
 *  - Every provider publishes a {@link TrackerCapabilities} descriptor so a
 *    caller degrades HONESTLY against a provider that lacks an operation
 *    (the op returns an `unsupported` failure) rather than faking success.
 *
 * Errors are DATA, never thrown: each operation resolves a {@link TrackerResult}
 * discriminated on `ok`, mirroring the Observer's errors-as-data exec seam.
 */
import { z } from 'zod';

/**
 * The provider's acting mode. `dry-run` (the safe default at `suggest` tier)
 * returns the would-be invocation as a proposal and spawns NOTHING; `execute`
 * (only at the `enforce` tier) performs the mutation.
 */
export type TrackerMode = 'dry-run' | 'execute';

/** The four core, provider-agnostic mutating operations a tracker exposes. */
export type TrackerOp = 'createIssue' | 'closeIssue' | 'comment' | 'addLabels';

/**
 * A first-pass SHAPE gate for an issue reference: a bare positive integer
 * (`42`), the `#42` form, or a full https issue URL. This is deliberately
 * provider-AGNOSTIC and therefore cannot enforce repo scope on its own — a URL
 * here may point at any host/repo. Each provider MUST additionally BIND a URL
 * ref to its configured repo and pass its backend a canonical issue NUMBER
 * (never the URL), so a ref can never redirect the backend to another repo or
 * host (see github.ts `parseRef`). Treat this schema as syntax, not authority.
 */
export const IssueRefSchema = z
  .string()
  .min(1)
  .refine(
    (ref) => /^#?\d+$/.test(ref) || /^https:\/\/[^\s]+\/\d+$/.test(ref),
    'issue ref must be a positive issue number (e.g. "42" or "#42") or a full https issue URL',
  );
export type IssueRef = z.infer<typeof IssueRefSchema>;

/**
 * A label name restricted to a conservative safe charset (letters, digits,
 * space, and `-`, `_`, `.`, `/`, `:`). The charset alone forbids a leading
 * `-` from being parsed (no label may start with `-`), so a label can never
 * be misread as a `gh` flag.
 */
export const LabelSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 _.\-/:]*$/,
    'label must start with an alphanumeric and use only letters, digits, space, and - _ . / :',
  );

/**
 * Maximum issue/comment body length (chars). A body is buffered in memory and
 * written to a temp file; the cap bounds that resource use and is well above
 * any real issue/comment. Enforced at the boundary so an oversize body is a
 * typed `invalid-input` failure, never an unbounded write.
 */
export const BODY_MAX = 65_536;

/** Boundary schema for {@link TrackerProvider.createIssue} input. */
export const CreateIssueInputSchema = z.strictObject({
  title: z.string().min(1).max(256),
  body: z.string().max(BODY_MAX),
  labels: z.array(LabelSchema).max(20).optional(),
});
export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

/** Boundary schema for a comment body (non-empty, bounded by {@link BODY_MAX}). */
export const CommentBodySchema = z.string().min(1).max(BODY_MAX);

/** A successful tracker operation: the affected issue ref (a number or URL). */
export interface TrackerSuccess {
  readonly ok: true;
  /** The created/affected issue ref the provider resolved (URL when known). */
  readonly ref: string;
}

/**
 * Reasons an operation fails, as DATA. `unsupported` = the provider's
 * capability descriptor declares the op `false` (honest degradation);
 * `invalid-input` = the boundary schema rejected it; `spawn-failed` = the
 * CLI could not start; `exit-nonzero` = the CLI ran and failed; `io-failed`
 * = a local I/O step (e.g. writing the temp body file) failed before/around
 * the spawn — surfaced as data so an op NEVER throws.
 */
export type TrackerFailureReason =
  | 'unsupported'
  | 'invalid-input'
  | 'spawn-failed'
  | 'exit-nonzero'
  | 'io-failed';

/** A failed tracker operation: a typed, scrubbed reason — never a thrown error. */
export interface TrackerFailure {
  readonly ok: false;
  readonly reason: TrackerFailureReason;
  /** Human-readable, secret-scrubbed detail (no token/path leak). */
  readonly message: string;
}

/** The result of one tracker operation; errors are data, never thrown. */
export type TrackerResult = TrackerSuccess | TrackerFailure;

/**
 * What a provider can do. A provider that lacks an operation declares it
 * `false`; the corresponding method then returns an `unsupported`
 * {@link TrackerFailure} so callers degrade honestly rather than fake it.
 *
 * ADVISORY contract, not yet a runtime gate: the only current provider
 * (GitHub) supports all four ops, so the `false`/`unsupported` path is an
 * interface obligation for FUTURE partial providers (e.g. a tracker lacking
 * label support) — such a provider must BOTH declare the op `false` here AND
 * return an `unsupported` failure from the method. No call site consults this
 * descriptor to gate an op today; it is published for honest feature-detection,
 * not presented as an active safety mechanism.
 */
export interface TrackerCapabilities {
  readonly createIssue: boolean;
  readonly closeIssue: boolean;
  readonly comment: boolean;
  readonly addLabels: boolean;
}

/**
 * A dry-run PROPOSAL: the exact provider-level invocation that `execute`
 * WOULD have run, surfaced without acting. `argv` is the literal args-array
 * (no shell string) the provider built; `bodyViaFile` flags that the body
 * was routed through a temp file (flag-injection defense) rather than inlined.
 */
export interface TrackerProposal {
  readonly op: TrackerOp;
  readonly command: string;
  readonly argv: readonly string[];
  readonly bodyViaFile: boolean;
}

/**
 * The provider-agnostic tracker interface. Each mutating method returns a
 * {@link TrackerResult}; in `dry-run` mode the method spawns nothing and the
 * result's `ref` is a synthetic `dry-run` marker, while the would-be
 * invocation is surfaced by the implementation (the GitHub provider exposes it
 * via its `proposals` array). The four ops are the portable core; richer
 * provider-specific features hang off {@link TrackerProvider.extensions}.
 */
export interface TrackerProvider {
  /** The provider's acting mode (`dry-run` is the safe default). */
  readonly mode: TrackerMode;
  /** Which operations this provider supports — honest degradation. */
  capabilities(): TrackerCapabilities;
  /** File a new issue (gated to `enforce`; a dry-run proposes only). */
  createIssue(input: CreateIssueInput): Promise<TrackerResult>;
  /** Close an existing issue, optionally with a reason. */
  closeIssue(ref: string, reason?: string): Promise<TrackerResult>;
  /** Comment on an existing issue. */
  comment(ref: string, body: string): Promise<TrackerResult>;
  /** Add labels to an existing issue. */
  addLabels(ref: string, labels: readonly string[]): Promise<TrackerResult>;
  /**
   * Modular hook seam for provider-specific features (e.g. GitHub Projects,
   * GitLab epics). MINIMAL by design — a typed, optional extension point, not
   * a built feature. A provider with no extensions leaves this `undefined`.
   */
  readonly extensions?: TrackerExtensions;
}

/**
 * Optional provider-specific extension surface. Kept deliberately empty in
 * the first build: it is the typed SEAM future provider features (Projects,
 * epics, milestones) attach to, declared so callers can feature-detect via
 * `provider.extensions?.<feature>` without the core interface growing.
 */
export interface TrackerExtensions {
  readonly [feature: string]: unknown;
}

/** Captured result of one tracker-CLI invocation; never throws (errors as data). */
export interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not even start (e.g. the CLI is absent). */
  readonly spawnError?: string;
}

/**
 * Injectable subprocess executor: takes the command and its ARGS-ARRAY (never
 * a shell string) and resolves the captured result. The default spawns the
 * real CLI; tests inject a mock to assert the exact argv a provider builds.
 */
export type TrackerExec = (command: string, args: readonly string[]) => Promise<ExecResult>;
