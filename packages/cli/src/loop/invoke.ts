/**
 * Model invocation for the canonical loop — ONE injectable seam. Every
 * generative node (plan, voters, PM decompose, coder children) flows through
 * a single `LoopInvoke` function; the default binds it to the kernel's
 * `invokeAdapter` for the adapter chosen by `--adapter` (availability is
 * probed up front with `detectAdapter` — an absent CLI is a typed
 * {@link AdapterUnavailableError}, never a stub). Tests inject a scripted
 * invoke: an honest double for the external model CLI, with everything
 * downstream of the seam real.
 *
 * Model outputs cross back into the system under a STRICT contract: one
 * JSON object is extracted from the raw text (whole output first, then the
 * first fenced block, then the first balanced object — string-aware) and
 * zod-parsed; anything malformed throws a typed {@link LoopParseError} and
 * the raw output is preserved under `<overlay>/checkpoints/` for diagnosis —
 * the loop never coerces model prose into data (prime directive: what is
 * recorded is what happened).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Cost, ModelTier } from '@kernloop/contracts';
import {
  AdapterUnavailableError,
  detectAdapter,
  invokeAdapter,
  type AdapterCommandEffort,
  type AdapterName,
} from '@kernloop/kernel';

/** Wall-clock budget for one loop model call when the caller sets none. */
export const LOOP_INVOKE_TIMEOUT_MS = 300_000;

/**
 * The one injectable model call: fully assembled prompt in, raw text plus
 * the metered (or honestly-zero) Cost out. The optional `model` + `effort`
 * are the SERVED model alias + resolved effort the composition root binds per
 * node (spec §8.4). `tier` is the node's REQUESTED tier — carried so a host
 * that picks the model itself (MCP sampling, #135/#140) can route high/med/low
 * from it; the CLI/api adapters resolve the model from the tier up front and
 * ignore it here. Default: {@link adapterInvoke}.
 */
export type LoopInvoke = (
  prompt: string,
  options?: {
    timeoutMs?: number;
    model?: string;
    effort?: AdapterCommandEffort;
    tier?: ModelTier;
  },
) => Promise<{ output: string; cost: Cost }>;

/** Typed failure parsing a model emission against its output contract. */
export class LoopParseError extends Error {
  readonly code = 'loop_parse';
  /** Which output contract was violated (ballot, subtasks, files). */
  readonly contract: string;
  /** The violation detail without the message prefix (re-thrown augmented). */
  readonly detail: string;
  constructor(contract: string, detail: string) {
    super(`model output violates the "${contract}" contract: ${detail}`);
    this.name = 'LoopParseError';
    this.contract = contract;
    this.detail = detail;
  }
}

/** Typed failure resuming a run that has no checkpoint on disk. */
export class LoopResumeError extends Error {
  readonly code = 'no_checkpoint';
  constructor(runId: string, file: string) {
    super(`no checkpoint found for run "${runId}" (looked in ${file})`);
    this.name = 'LoopResumeError';
  }
}

/**
 * Probe PATH for the chosen adapter and throw the kernel's typed
 * unavailability error when its CLI is absent — BEFORE any loop node runs,
 * so a misconfigured environment fails fast instead of mid-loop.
 */
export function ensureAdapterAvailable(
  adapter: AdapterName,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const probe = detectAdapter(adapter, env);
  if (!probe.available) {
    throw new AdapterUnavailableError(adapter, probe.command, probe.probedPaths);
  }
}

/** The default LoopInvoke: the kernel adapter for `adapter`, metered per
 * call. `env` is injectable for tests; default `process.env`. `cwd`, when set,
 * is the task WORKSPACE every adapter subprocess runs in — so an agentic model
 * CLI is grounded in (and confined to) the workspace, not kernloop's launch
 * directory (#146). Omitted ⇒ the child inherits the launch cwd. */
export function adapterInvoke(
  adapter: AdapterName,
  env?: Readonly<Record<string, string | undefined>>,
  cwd?: string,
): LoopInvoke {
  return async (prompt, options = {}) => {
    const result = await invokeAdapter(adapter, {
      prompt,
      timeoutMs: options.timeoutMs ?? LOOP_INVOKE_TIMEOUT_MS,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(env === undefined ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
    });
    return { output: result.output, cost: result.cost };
  };
}

/**
 * The loop's running model-spend accumulator: the flat tokens/usd total plus an
 * optional per-adapter breakdown (#44) so a tiered run's spend is attributable
 * to the adapter that incurred it. `byAdapter` is filled lazily — only adapters
 * that actually metered a call appear.
 */
export interface RunTotals {
  tokens: number;
  usd: number;
  byAdapter?: Record<string, { tokens: number; usd: number }>;
}

/**
 * Wrap an invoke so every call's metered tokens/usd accumulate into `totals` —
 * the loop's honest model-spend aggregate, reported on the run's final cost.
 * When `adapter` is given, the same spend is also attributed to that adapter's
 * bucket in `totals.byAdapter` (#44).
 */
export function meteredInvoke(base: LoopInvoke, totals: RunTotals, adapter?: string) {
  const wrapped: LoopInvoke = async (prompt, options) => {
    const result = await base(prompt, options);
    totals.tokens += result.cost.tokens;
    totals.usd += result.cost.usd;
    if (adapter !== undefined) {
      const by = (totals.byAdapter ??= {});
      const bucket = (by[adapter] ??= { tokens: 0, usd: 0 });
      bucket.tokens += result.cost.tokens;
      bucket.usd += result.cost.usd;
    }
    return result;
  };
  return wrapped;
}

/** The first fenced code block (``` or ```json) in model output. */
const FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;

/**
 * Extract ONE JSON object from raw model text (models wrap JSON in prose
 * and code fences; the contract is "a single JSON object", extracted, not
 * trusted). Preference order, most honest reading first:
 * 1. the WHOLE trimmed output parsed as JSON (the contract's happy path);
 * 2. the first fenced code block, when it contains an object;
 * 3. the first balanced `{…}` in the text that PARSES as JSON, string-aware
 *    (braces and quotes inside JSON strings do not count; backslash escapes are
 *    honored) [CLM-0107]. Trying EACH balanced object and returning the first that parses —
 *    rather than the first `{` outright — lets the extractor skip prose/code
 *    snippets an AGENTIC coder CLI wraps around the contract object (#130: a
 *    headless `claude` narrates "let me produce the files: `flags() {…}`" before
 *    emitting the real JSON; the snippet's braces are not valid JSON and must be
 *    stepped over, not parsed).
 * Returns the parsed value or throws {@link LoopParseError} naming the
 * contract — truncated output stays an unterminated-object failure.
 */
export function extractJsonObject(raw: string, contract: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Prose/fences around the object, or truncation — the scan below
      // extracts or reports which.
    }
  }
  const fenced = FENCE.exec(trimmed)?.[1];
  const candidate = fenced !== undefined && fenced.includes('{') ? fenced : trimmed;
  return firstParsableObject(candidate, contract);
}

/** The index of the `}` balancing the `{` at `start` (string-aware), or -1 when
 * it is unterminated (no further top-level object can close after it). */
function balancedClose(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The first balanced `{…}` in `text` that successfully JSON-parses, string-
 * aware. Steps over balanced-but-non-JSON snippets (agentic-CLI prose) instead
 * of failing on the first `{` (#130). Throws {@link LoopParseError} naming the
 * contract when no balanced object parses or the text has no `{`. */
function firstParsableObject(text: string, contract: string): unknown {
  let i = 0;
  let reason = 'no JSON object found in the output';
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    const end = balancedClose(text, start);
    if (end === -1) {
      reason = 'unterminated JSON object in the output';
      break;
    }
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      reason = 'no parsable JSON object found in the output';
    }
    i = end + 1;
  }
  throw new LoopParseError(contract, reason);
}

/** A voter's raw ballot — the strict voter output contract. */
export const BallotEmissionSchema = z.strictObject({
  vote: z.enum(['approve', 'reject', 'abstain']),
  reasoning: z.string(),
});

/** The PM's raw decomposition — subtask specs the workforce faculty enforces. */
export const SubtasksEmissionSchema = z.strictObject({
  subtasks: z
    .array(
      z.looseObject({}), // each element is SubtaskSpec — decomposePlan zod-parses it with typed per-index errors
    )
    .min(1),
});

/** The coder's raw emission — files to write plus free-form notes. */
export const FilesEmissionSchema = z.strictObject({
  files: z.array(z.strictObject({ path: z.string().min(1), content: z.string() })).min(1),
  notes: z.string().default(''),
});

/**
 * Where a contract violation's raw model output is preserved for diagnosis:
 * `<overlayDir>/checkpoints/<runId>-<node>-violation.txt` (machine-local —
 * `kernloop init` gitignores `checkpoints/`).
 */
export interface ViolationSink {
  /** Overlay directory; the file lands under its `checkpoints/`. */
  readonly overlayDir: string;
  readonly runId: string;
  /** Node label for the file name, e.g. `implement-task-1.2`. */
  readonly node: string;
}

/** Persist one violating raw output; returns the file path written. */
export function persistViolation(sink: ViolationSink, raw: string): string {
  const safe = (part: string): string => part.replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(
    sink.overlayDir,
    'checkpoints',
    `${safe(sink.runId)}-${safe(sink.node)}-violation.txt`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, raw, 'utf8');
  return file;
}

/**
 * Extract + zod-parse one model emission under a named contract. With a
 * `sink`, a violation's raw output is persisted (honest diagnosability —
 * no retry, no coercion; the failure stays a failure) and the re-thrown
 * error names where it was preserved.
 */
export function parseEmission<T extends z.ZodType>(
  raw: string,
  schema: T,
  contract: string,
  sink?: ViolationSink,
): z.output<T> {
  try {
    const result = schema.safeParse(extractJsonObject(raw, contract));
    if (!result.success) throw new LoopParseError(contract, z.prettifyError(result.error));
    return result.data as z.output<T>;
  } catch (error) {
    if (sink === undefined || !(error instanceof LoopParseError)) throw error;
    const file = persistViolation(sink, raw);
    throw new LoopParseError(
      error.contract,
      `${error.detail} (raw model output preserved at ${file})`,
    );
  }
}
