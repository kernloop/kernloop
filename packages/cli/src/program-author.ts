/**
 * The AUTHOR half of `kernloop program` (spec §5.4; CLM-0103, #104). Where
 * `decompose` reads the story specs from a `--spec` file, `author` asks a MODEL
 * to PROPOSE them: the model breaks the goal into an epic/story plan and emits a
 * JSON array of story specs, which is then run through the exact same
 * `decomposeGoal` faculty the file-driven verb uses. The model PROPOSES, the
 * faculty ENFORCES (the per-dimension budget-sum invariant, identity/overlay/
 * ceiling derivation, altitude/assign tagging), and the human RATIFIES the
 * printed tree before feeding it to `create`/`emit`.
 *
 * It is SUGGEST-TIER and MUTATES NOTHING: no ledger write, no GitHub, no loop
 * run — it prints the proposed `{ op, adapter, parent, children }` tree only,
 * plus one `cli.program.author` audit event (op/adapter/parentId/childCount/
 * goalChars — never the goal or the model output verbatim).
 *
 * The model output is parsed ROBUSTLY (the response may wrap the JSON in
 * markdown fences or prose) and validated against `StorySpecSchema`; a non-JSON
 * / non-array / schema-invalid / budget-breaching output is a CLEAN exit 1
 * (`ProgramInputError` or the faculty's typed error), never an unhandled throw
 * and never silently fabricated specs (prime directive: what is printed is what
 * the model proposed). The model is invoked through the SAME `adapterInvoke`
 * seam as distill/gate; tests inject `options.invoke`.
 */
import { appendEvent } from '@kernloop/kernel';
import { decomposeGoal, StorySpecSchema, type StorySpec } from '@kernloop/faculty-scrum';
import { z } from 'zod';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import { type LoopInvoke } from './loop/invoke.js';
import { resolveStandaloneInvoke } from './loop/standalone-invoke.js';
import { isCliAdapter } from './overlay-schemas.js';
import {
  buildProgramParent,
  checkIdLength,
  isCleanError,
  ProgramInputError,
} from './program-shared.js';

/** The shared usage line `program author` rejects bad input with. */
export const AUTHOR_USAGE = 'usage: kernloop program author --goal G [--id ID] [--adapter A]';

/** The story-spec array the model is asked to emit, validated before decompose. */
const AuthoredSpecsSchema = z.array(StorySpecSchema);

/** Build the model prompt: the goal + the parent's budget so the model
 * allocates the children WITHIN it, plus the EXACT JSON-array shape to emit. */
function authorPrompt(
  goal: string,
  budget: { tokens: number; usd: number; wallClockMin: number },
): string {
  return [
    'You are a program manager decomposing a software GOAL into an epic/story plan.',
    `GOAL: ${goal}`,
    '',
    'The whole program has this TOTAL budget; the children you propose must each',
    'have a positive budget and their budgets must SUM WITHIN this total on every',
    'dimension independently (tokens, usd, wallClockMin):',
    `  tokens: ${String(budget.tokens)}`,
    `  usd: ${String(budget.usd)}`,
    `  wallClockMin: ${String(budget.wallClockMin)}`,
    '',
    'Output ONLY a JSON array of story specs — no prose, no markdown fences.',
    'Each element MUST be exactly this shape:',
    '  {',
    '    "goal": string,',
    '    "budget": { "tokens": integer>0, "usd": number>0, "wallClockMin": number>0 },',
    '    "assignTo": one of "pm" | "coder" | "reviewer" | "documenter" | "researcher",',
    '    "altitude": one of "epic" | "story" | "task",',
    '    "track"?: string,',
    '    "sprint"?: string',
    '  }',
  ].join('\n');
}

/** A fenced ```json … ``` code block, if the model wrapped its output in one. */
const FENCE = /```(?:json)?\s*\n([\s\S]*?)```/;

/** Extract the first top-level JSON ARRAY from raw model text. PREFERS a fenced
 * ```json block when present (so prose brackets like "item [1]" before the
 * fence can't be mis-grabbed), then falls back to scanning the whole text. The
 * scan is string-aware: brackets and quotes inside JSON strings do not count;
 * backslash escapes are honored. */
function extractJsonArray(raw: string): string {
  const candidate = FENCE.exec(raw)?.[1] ?? raw;
  const start = candidate.indexOf('[');
  if (start === -1) {
    throw new ProgramInputError('model output contained no JSON array of story specs');
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new ProgramInputError('model output had an unterminated JSON array of story specs');
}

/** Parse + validate the model output into story specs, or a clean input error
 * (never a fabricated spec). Robust to fences/prose around the JSON array. */
function parseAuthoredSpecs(raw: string): StorySpec[] {
  const text = extractJsonArray(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProgramInputError(
      `model output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = AuthoredSpecsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProgramInputError(
      `model output is not a valid array of story specs: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/** The chosen invoke, or the real adapter — a CLI name OR a registered endpoint
 * (#395); mirrors distill/gate exactly. */
function resolveInvoke(kern: Kernloop, adapter: string, invoke?: LoopInvoke): LoopInvoke {
  if (invoke !== undefined) return invoke;
  return resolveStandaloneInvoke(kern, adapter);
}

/**
 * Run `program author` [CLM-0103]: require `--goal`, build the suggest-tier
 * parent, invoke the model for the story specs, parse them robustly, run them
 * through the deterministic `decomposeGoal` faculty, print the proposed tree,
 * and audit once. Typed faculty/input errors (no goal, malformed/invalid/
 * budget-breaching model output) surface as a clean exit 1, never a throw. It
 * mutates nothing.
 */
export async function authorOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
  invoke?: LoopInvoke,
): Promise<number> {
  const goal = str(v.goal);
  if (goal === undefined) throw new Error(AUTHOR_USAGE);
  const id = str(v.id) ?? 'program-root';
  try {
    checkIdLength(id);
    // CLI name OR registered endpoint id (#395). Validated here as a clean typed
    // error (the adapter is also audited, so it must be real even with an injected
    // invoke); resolveStandaloneInvoke re-checks on the real model path.
    const adapter = str(v.adapter) ?? 'claude';
    if (!isCliAdapter(adapter) && kern.config.endpoints[adapter] === undefined) {
      throw new ProgramInputError(
        `--adapter "${adapter}" is neither a CLI adapter nor a registered endpoint id`,
      );
    }
    const parent = buildProgramParent(kern, id, goal);
    const { output } = await resolveInvoke(
      kern,
      adapter,
      invoke,
    )(authorPrompt(goal, parent.budget));
    const specs = parseAuthoredSpecs(output);
    const children = decomposeGoal({ parent, subtasks: specs });
    appendEvent(kern.store, {
      type: 'cli.program.author',
      payload: {
        op: 'author',
        adapter,
        parentId: id,
        childCount: children.length,
        goalChars: goal.length,
      },
    });
    io.out(JSON.stringify({ op: 'author', adapter, parent, children }, null, 2));
    return 0;
  } catch (error) {
    if (isCleanError(error)) {
      io.err(JSON.stringify({ error: error.name, message: error.message }, null, 2));
      return 1;
    }
    throw error;
  }
}
