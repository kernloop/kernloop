/**
 * Typed errors thrown at the toolsmith's boundaries. Callers discriminate on
 * `name` or `instanceof` — never on message text.
 *
 * The sandbox errors (`SandboxUnavailableError`, `SandboxProfileMismatchError`,
 * `SandboxMountError`) moved to the kernel with the sandbox primitive (#234)
 * and are re-exported here so existing `./errors.js` consumers are unchanged.
 */
export {
  SandboxUnavailableError,
  SandboxProfileMismatchError,
  SandboxMountError,
} from '@kernloop/kernel';

/**
 * Thrown when a tool spec arrives at `forge` without a complete birth
 * certificate — claim entry, acceptance test, and ManifestSchema-valid
 * manifest (kind `workshopTool`, tier `suggest`, `workshop/`-namespaced
 * name) — or without an injected generator. Thrown BEFORE any generation or
 * docker call (spec §5.6: birth requirements precede the build; CLM-0051).
 */
export class ForgeBirthError extends Error {
  /** One entry per missing/invalid birth requirement. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`forge refused: birth requirements unmet (spec §5.6) — ${problems.join('; ')}`);
    this.name = 'ForgeBirthError';
    this.problems = problems;
  }
}

/**
 * Thrown when forging would exceed the live-tool cap (12 per overlay,
 * profile.liveToolCapPerOverlay). At cap, forging requires retiring —
 * scarcity forces consolidation (spec §5.6; CLM-0053).
 */
export class WorkshopCapError extends Error {
  readonly cap: number;

  constructor(cap: number) {
    super(
      `workshop is at its cap of ${cap} live tools — retire() one (human-ratified) before forging another (spec §5.6)`,
    );
    this.name = 'WorkshopCapError';
    this.cap = cap;
  }
}

/**
 * Thrown when a generated tool fails its acceptance test inside the sandbox.
 * The tool is NOT installed; the scratch directory is preserved for
 * diagnosis and its path travels on the error.
 */
export class ForgeTestFailedError extends Error {
  /** Preserved scratch directory holding tool.mjs + test.mjs for diagnosis. */
  readonly scratchDir: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    scratchDir: string,
    exitCode: number,
    timedOut: boolean,
    stdout: string,
    stderr: string,
  ) {
    super(
      `acceptance test failed in sandbox (exit ${exitCode}${timedOut ? ', timed out' : ''}) — ` +
        `tool not installed; scratch preserved for diagnosis at ${scratchDir}`,
    );
    this.name = 'ForgeTestFailedError';
    this.scratchDir = scratchDir;
    this.exitCode = exitCode;
    this.timedOut = timedOut;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Thrown when an action that requires human ratification (retire; promote to
 * enforce) arrives without a `ratifiedBy`. Removal is always human-ratified
 * (spec §3.2); enforce is never automatic (spec §5.6; CLM-0054).
 */
export class RatificationRequiredError extends Error {
  constructor(action: string) {
    super(`${action} requires human ratification — provide ratifiedBy (spec §3.2, §5.6)`);
    this.name = 'RatificationRequiredError';
  }
}

/**
 * Thrown when a workshop tool name is unsafe as a directory name (path
 * traversal, separators, uppercase, leading dots). Names are the segment
 * after `workshop/` and must match SAFE_TOOL_NAME.
 */
export class WorkshopNameError extends Error {
  constructor(name: string) {
    super(`unsafe workshop tool name ${JSON.stringify(name)} — must match /^[a-z0-9][a-z0-9-]*$/`);
    this.name = 'WorkshopNameError';
  }
}

/**
 * Thrown when a promotion skips a rung — `enforce` is reachable only from
 * `advisory`. The ladder is climbed one rung at a time (spec §3.2).
 */
export class LadderOrderError extends Error {
  constructor(currentTier: string) {
    super(
      `cannot promote to enforce from '${currentTier}' — the tool must hold advisory first (spec §3.2)`,
    );
    this.name = 'LadderOrderError';
  }
}

/** Thrown when an operation references a workshop tool that does not exist. */
export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`no live workshop tool named ${JSON.stringify(name)} in this overlay`);
    this.name = 'UnknownToolError';
  }
}
