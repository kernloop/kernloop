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
import type { Cost } from '@kernloop/contracts';
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
 * node (spec §8.4). Default: {@link adapterInvoke}.
 */
export type LoopInvoke = (
  prompt: string,
  options?: { timeoutMs?: number; model?: string; effort?: AdapterCommandEffort },
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
 * call. `env` is injectable for tests; default `process.env`. */
export function adapterInvoke(
  adapter: AdapterName,
  env?: Readonly<Record<string, string | undefined>>,
): LoopInvoke {
  return async (prompt, options = {}) => {
    const result = await invokeAdapter(adapter, {
      prompt,
      timeoutMs: options.timeoutMs ?? LOOP_INVOKE_TIMEOUT_MS,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(env === undefined ? {} : { env }),
    });
    return { output: result.output, cost: result.cost };
  };
}

/**
 * Wrap an invoke so every call's metered tokens/usd accumulate into
 * `totals` — the loop's honest model-spend aggregate, reported on the run's
 * final cost.
 */
export function meteredInvoke(base: LoopInvoke, totals: { tokens: number; usd: number }) {
  const wrapped: LoopInvoke = async (prompt, options) => {
    const result = await base(prompt, options);
    totals.tokens += result.cost.tokens;
    totals.usd += result.cost.usd;
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
 * 3. the first balanced `{…}` in the text, string-aware (braces and quotes
 *    inside JSON strings do not count; backslash escapes are honored).
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
  return firstBalancedObject(candidate, contract);
}

/** The first balanced `{…}` in `text`, string-aware, parsed as JSON. */
function firstBalancedObject(text: string, contract: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new LoopParseError(contract, 'no JSON object found in the output');
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
      if (depth === 0) return parseJson(text.slice(start, i + 1), contract);
    }
  }
  throw new LoopParseError(contract, 'unterminated JSON object in the output');
}

/** JSON.parse with the typed loop error instead of a bare SyntaxError. */
function parseJson(text: string, contract: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new LoopParseError(
      contract,
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
