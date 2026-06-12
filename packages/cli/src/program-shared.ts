/**
 * Shared program-CLI helpers (spec §5.4) used by both `program decompose`
 * [CLM-0096] and `program emit` [CLM-0098]: the typed input error, the parent
 * TaskContract builder, the size-gated spec reader, and the clean-error guard.
 * Extracted so the emit verb reuses the exact same parent/spec derivation as
 * the preview verb — the two cannot diverge on how a program tree is built.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TaskContractSchema, type TaskContract } from '@kernloop/contracts';
import {
  InvalidParentError,
  InvalidStorySpecError,
  ScrumBudgetExceededError,
  UnsafeLabelError,
  type StorySpec,
} from '@kernloop/faculty-scrum';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import {
  DuplicateProgramError,
  InvalidNodeTransitionError,
  UnknownProgramNodeError,
} from './program-store.js';

/** Max length of a `--id`/`--parent` value (it is audited verbatim as parentId). */
export const ID_MAX = 256;

/** Max `--spec` file size in bytes — bounds the in-memory read (a story-spec
 * array is small; a multi-MB file is a mistake, not a program plan). */
const SPEC_MAX_BYTES = 1_048_576;

/** A bad `--id`/`--spec` input (missing/oversize/malformed/non-array) — surfaced
 * as a clean nonzero exit, never an unhandled throw. */
export class ProgramInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgramInputError';
  }
}

/** The typed errors the program verbs (decompose/emit + the ledger verbs)
 * surface as a clean nonzero exit, never an unhandled throw. */
export function isCleanError(error: unknown): error is Error {
  return (
    error instanceof ScrumBudgetExceededError ||
    error instanceof InvalidParentError ||
    error instanceof InvalidStorySpecError ||
    error instanceof UnsafeLabelError ||
    error instanceof ProgramInputError ||
    error instanceof DuplicateProgramError ||
    error instanceof UnknownProgramNodeError ||
    error instanceof InvalidNodeTransitionError
  );
}

/** Build the parent program TaskContract from the goal + overlay defaults. */
export function buildProgramParent(kern: Kernloop, id: string, goal: string): TaskContract {
  return TaskContractSchema.parse({
    id,
    goal,
    constraints: [],
    budget: kern.config.budgets,
    evidence: [],
    definitionOfDone: [],
    // Program decomposition is a suggest-tier preview; children clamp to suggest.
    authorityCeiling: 'suggest',
    overlay: kern.config.id,
  });
}

/** Read + JSON.parse the `--spec` file (size-gated), requiring a top-level
 * array. Every failure (missing/oversize/unreadable/malformed/non-array) is a
 * typed {@link ProgramInputError} so the caller surfaces a clean exit, never a
 * raw fs/JSON throw — honoring the program verbs' errors-as-clean-exit contract. */
export function readSpecFile(io: CliIo, file: string): StorySpec[] {
  const resolved = path.resolve(io.cwd, file);
  let text: string;
  try {
    const size = statSync(resolved).size;
    if (size > SPEC_MAX_BYTES) {
      throw new ProgramInputError(
        `--spec file is ${String(size)} bytes (max ${String(SPEC_MAX_BYTES)})`,
      );
    }
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    if (error instanceof ProgramInputError) throw error;
    throw new ProgramInputError(
      `--spec file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProgramInputError(
      `--spec file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ProgramInputError(
      `--spec file must be a JSON array of story specs (got ${typeof parsed})`,
    );
  }
  return parsed as StorySpec[];
}

/** Assert the `--id`/`--parent` value is within the audited-verbatim length cap. */
export function checkIdLength(id: string): void {
  if (id.length > ID_MAX) {
    throw new ProgramInputError(
      `--id/--parent is too long (${String(id.length)} > ${String(ID_MAX)})`,
    );
  }
}
