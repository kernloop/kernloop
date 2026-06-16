/**
 * Uniform adapter invocation + per-call metering (spec §3.1 Adapters,
 * spec §8 item 4's substrate: adapters meter, the Router tiers).
 *
 * `invokeAdapter(name, …)` is the one entry point for all five model CLIs:
 * resolve the executable on PATH (unavailable ⇒ typed
 * {@link AdapterUnavailableError}, never a stub), run it under a wall-clock
 * timeout, parse the recorded output format, and report a contracts-shaped
 * {@link Cost} for EVERY call. Duration is always measured; tokens/usd come
 * only from what the CLI itself reported — when it reports nothing they are
 * 0 with `metered.tokens`/`metered.usd` set false. Numbers are never
 * fabricated (honesty over completeness).
 *
 * @module kernel/adapters/invoke
 */

import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CostSchema, type Cost } from '@kernloop/contracts';
import {
  adapterDefinitions,
  type AdapterCommandEffort,
  type AdapterName,
  type AdapterUsage,
} from './definitions.js';
import {
  AdapterExecutionError,
  AdapterOutputError,
  AdapterRequestError,
  AdapterTimeoutError,
  AdapterUnavailableError,
} from './errors.js';
import { runSubprocess, type SubprocessResult } from './subprocess.js';
import { scopedChildEnv } from './env.js';

/** Environment shape accepted everywhere here (process.env-compatible). */
export type AdapterEnv = Readonly<Record<string, string | undefined>>;

/** Result of probing PATH for one adapter's executable. */
export interface AdapterAvailability {
  /** Adapter that was probed. */
  readonly adapter: AdapterName;
  /** Executable name that was looked up. */
  readonly command: string;
  /** True when an executable candidate was found. */
  readonly available: boolean;
  /** Resolved executable path, or null when unavailable. */
  readonly resolvedPath: string | null;
  /** Every candidate path probed, in PATH order. */
  readonly probedPaths: readonly string[];
}

/** One adapter call: the assembled prompt, a budget, and pass-throughs. */
export interface AdapterInvocation {
  /** Fully assembled prompt — adapters do no prompt assembly (spec §3.1). */
  readonly prompt: string;
  /** Wall-clock budget in ms; on breach the CLI's process tree is killed. */
  readonly timeoutMs: number;
  /** Model identifier chosen by the caller — no routing decisions here. */
  readonly model?: string;
  /**
   * Resolved effort knob the caller already translated (spec §8.4). The
   * adapter shapes it into argv when its `via` is `arg`; omitted ⇒ no effort
   * arg (dropped honestly). No translation happens here — the caller resolves
   * the literal through the translation seam.
   */
  readonly effort?: AdapterCommandEffort;
  /** Environment for PATH probing and the child; default `process.env`. */
  readonly env?: AdapterEnv;
  /**
   * Extra env var NAMES to pass through to the CLI child beyond the benign base
   * allowlist (#227): a key-authenticated CLI names its provider key here (the
   * composition root threads the overlay's `adapterEnvAllow`). The child NEVER
   * receives the full parent env — only the allowlist ∪ these names — so host
   * secrets (other providers' keys, GH_TOKEN, cloud creds) are not exposed.
   */
  readonly envAllow?: readonly string[];
  /**
   * Working directory for the CLI child — the task WORKSPACE (#146). Omitted ⇒
   * the child inherits kernloop's launch cwd, which for an agentic CLI exposes
   * the launch directory; callers driving the canonical loop set this so model
   * nodes are grounded in (and confined to) the workspace, not the launch dir.
   */
  readonly cwd?: string;
}

/** Which Cost figures were actually reported by the CLI on this call. */
export interface MeteredFlags {
  /** True when `cost.tokens` came from CLI-reported usage. */
  readonly tokens: boolean;
  /** True when `cost.usd` came from CLI-reported cost. */
  readonly usd: boolean;
}

/** The uniform result every adapter returns. */
export interface AdapterResult {
  /** The adapter invoked. */
  readonly adapter: AdapterName;
  /** Response text extracted from the CLI's output format. */
  readonly output: string;
  /** Contracts-shaped realized cost; `wallClockMs` is always measured. */
  readonly cost: Cost;
  /** Honesty flags: which cost figures the CLI actually reported. */
  readonly metered: MeteredFlags;
  /** The raw subprocess observation (stdout/stderr/exit/duration). */
  readonly raw: SubprocessResult;
}

/** True when `path` exists and is executable by this process. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe PATH for an adapter's executable. Pure PATH lookup — no caching, no
 * version checks; the probe lists every candidate so an unavailability
 * report can show exactly what was tried.
 */
export function detectAdapter(
  adapter: AdapterName,
  env: AdapterEnv = process.env,
): AdapterAvailability {
  const { command } = adapterDefinitions[adapter];
  const pathValue = env.PATH ?? '';
  const probedPaths: string[] = [];
  let resolvedPath: string | null = null;
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, command);
    probedPaths.push(candidate);
    if (resolvedPath === null && isExecutable(candidate)) resolvedPath = candidate;
  }
  return { adapter, command, available: resolvedPath !== null, resolvedPath, probedPaths };
}

/**
 * Build the contracts Cost for one call. `wallClockMs` is the measured
 * duration; tokens/usd are the CLI-reported figures or 0 when unreported
 * (the accompanying {@link MeteredFlags} say which). zod-validated at the
 * boundary, like every contract-shaped value (AGENTS.md coding standards).
 */
function buildCost(adapter: AdapterName, usage: AdapterUsage | null, durationMs: number): Cost {
  const tokens = usage === null ? 0 : usage.inputTokens + usage.outputTokens;
  const usd = usage?.usd ?? 0;
  return CostSchema.parse({
    tokens,
    usd,
    wallClockMs: durationMs,
    byAdapter: { [adapter]: { tokens, usd } },
  });
}

/** Reject invocations the definition cannot honestly execute. */
function checkInvocation(adapter: AdapterName, invocation: AdapterInvocation): void {
  const definition = adapterDefinitions[adapter];
  if (definition.requiresModel && (invocation.model === undefined || invocation.model === '')) {
    throw new AdapterRequestError(adapter, 'requires an explicit model (no default exists)');
  }
  if (!Number.isFinite(invocation.timeoutMs) || invocation.timeoutMs <= 0) {
    throw new AdapterRequestError(adapter, 'timeoutMs must be a positive finite number');
  }
}

/**
 * Invoke one model CLI through the uniform adapter interface.
 *
 * Failure is always a typed error, never a stubbed result:
 * - {@link AdapterUnavailableError} — CLI not on PATH (lists probed paths)
 * - {@link AdapterRequestError} — malformed invocation
 * - {@link AdapterTimeoutError} — wall-clock breach, process tree killed
 * - {@link AdapterExecutionError} — CLI exited non-zero / was signal-killed
 * - {@link AdapterOutputError} — exit 0 but no usable response in stdout
 */
export async function invokeAdapter(
  adapter: AdapterName,
  invocation: AdapterInvocation,
): Promise<AdapterResult> {
  const definition = adapterDefinitions[adapter];
  checkInvocation(adapter, invocation);

  const env = invocation.env ?? process.env;
  const availability = detectAdapter(adapter, env);
  if (availability.resolvedPath === null) {
    throw new AdapterUnavailableError(adapter, definition.command, availability.probedPaths);
  }

  const request = {
    prompt: invocation.prompt,
    ...(invocation.model === undefined ? {} : { model: invocation.model }),
    ...(invocation.effort === undefined ? {} : { effort: invocation.effort }),
  };
  const command = definition.buildCommand(request);
  const raw = await runSubprocess({
    command: availability.resolvedPath,
    args: command.args,
    ...(command.stdin === undefined ? {} : { stdin: command.stdin }),
    timeoutMs: invocation.timeoutMs,
    // Least-privilege CHILD env (#227): the benign allowlist plus the caller's
    // declared extras — NOT the full parent env. PATH probing above still used
    // the full `env` (a read, not a hand-off to the third-party binary).
    env: scopedChildEnv(env, invocation.envAllow ?? []),
    ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
  });

  if (raw.timedOut) throw new AdapterTimeoutError(adapter, invocation.timeoutMs, raw.durationMs);
  if (raw.exitCode !== 0) {
    throw new AdapterExecutionError(adapter, raw.exitCode, raw.signal, raw.stderr);
  }

  const parsed = definition.parseOutput(raw.stdout);
  if (parsed.output === null) throw new AdapterOutputError(adapter, raw.stdout, raw.stderr);

  return {
    adapter,
    output: parsed.output,
    cost: buildCost(adapter, parsed.usage, raw.durationMs),
    metered: { tokens: parsed.usage !== null, usd: parsed.usage?.usd != null },
    raw,
  };
}
