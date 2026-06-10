/**
 * The workshop authority ladder (spec §5.6, §3.2; CLM-0054), persisted as
 * `<overlayDir>/workshop/lifecycle.json` — per-tool records plus an in-file
 * append-only history of every transition. Kernel-side audit of these
 * transitions happens at composition-root wiring; this faculty keeps the
 * workshop's own lifecycle ledger.
 *
 * Ladder: born `suggest` → `advisory` automatically after
 * N_CLEAN_RUNS_FOR_ADVISORY consecutive clean audited runs → `enforce` ONLY
 * with human ratification. Decay: unused beyond the ratified profile's
 * decayWindowDays demotes one tier per sweep; a tool decayed to `suggest`
 * and still unused is marked `removal_proposed` (the removal itself still
 * goes through retire() with ratifiedBy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { LadderOrderError, RatificationRequiredError, UnknownToolError } from './errors.js';
import { RATIFIED_SANDBOX_PROFILE } from './profile.js';

/**
 * Clean audited runs required for the automatic suggest → advisory
 * promotion. Chosen as 5: enough consecutive green runs to demonstrate the
 * tool behaves under real use, small enough that useful tools are not stuck
 * at suggest for weeks (spec §5.6 leaves N open; ratified with the P3 exit).
 */
export const N_CLEAN_RUNS_FOR_ADVISORY = 5;

/** Tiers a workshop tool can hold (it is never a passive `observe` probe). */
export type WorkshopTier = 'suggest' | 'advisory' | 'enforce';

/** Per-tool ladder state. */
export interface ToolLifecycle {
  readonly name: string;
  readonly tier: WorkshopTier;
  /** Consecutive clean audited runs since the last unclean one. */
  readonly cleanRuns: number;
  /** Epoch ms of the most recent recorded run. */
  readonly lastUsedAt: number;
  /** Epoch ms the tool was installed. */
  readonly born: number;
  /** `live` until decay proposes removal; removal still needs retire(). */
  readonly status: 'live' | 'removal_proposed';
  /** Epoch ms of the most recent decay demotion, when one has happened. */
  readonly decayedAt?: number;
}

/** One history entry — every transition is appended, none rewritten. */
export interface LifecycleEvent {
  readonly at: number;
  readonly tool: string;
  readonly event: 'born' | 'run' | 'promoted' | 'decayed' | 'removal_proposed' | 'retired';
  readonly from?: WorkshopTier;
  readonly to?: WorkshopTier;
  readonly clean?: boolean;
  readonly automatic?: boolean;
  readonly ratifiedBy?: string;
}

/** Shape of lifecycle.json. */
export interface LifecycleFile {
  tools: Record<string, ToolLifecycle>;
  history: LifecycleEvent[];
}

function lifecyclePath(overlayDir: string): string {
  return path.join(path.resolve(overlayDir), 'workshop', 'lifecycle.json');
}

/** Read the overlay's lifecycle ledger; absent file → empty ledger. */
export function loadLifecycle(overlayDir: string): LifecycleFile {
  const file = lifecyclePath(overlayDir);
  if (!fs.existsSync(file)) return { tools: {}, history: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LifecycleFile;
}

function saveLifecycle(overlayDir: string, data: LifecycleFile): void {
  const file = lifecyclePath(overlayDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function requireTool(data: LifecycleFile, name: string): ToolLifecycle {
  const tool = data.tools[name];
  if (tool === undefined) throw new UnknownToolError(name);
  return tool;
}

/** Register a freshly installed tool — born at `suggest` (spec §5.6). */
export function registerTool(options: { overlayDir: string; name: string; at: number }): void {
  const data = loadLifecycle(options.overlayDir);
  data.tools[options.name] = {
    name: options.name,
    tier: 'suggest',
    cleanRuns: 0,
    lastUsedAt: options.at,
    born: options.at,
    status: 'live',
  };
  data.history.push({ at: options.at, tool: options.name, event: 'born', to: 'suggest' });
  saveLifecycle(options.overlayDir, data);
}

/**
 * Record one audited run. Clean runs accumulate; an unclean run resets the
 * streak. Every run refreshes lastUsedAt (the decay clock). After recording,
 * the earned suggest → advisory promotion is applied automatically.
 */
export function recordRun(options: {
  overlayDir: string;
  name: string;
  clean: boolean;
  at: number;
}): ToolLifecycle {
  const data = loadLifecycle(options.overlayDir);
  const tool = requireTool(data, options.name);
  data.tools[options.name] = {
    ...tool,
    cleanRuns: options.clean ? tool.cleanRuns + 1 : 0,
    lastUsedAt: options.at,
  };
  data.history.push({ at: options.at, tool: options.name, event: 'run', clean: options.clean });
  saveLifecycle(options.overlayDir, data);
  return promoteIfEarned({ overlayDir: options.overlayDir, name: options.name, at: options.at });
}

/**
 * Apply the automatic suggest → advisory promotion when earned: at least
 * N_CLEAN_RUNS_FOR_ADVISORY consecutive clean runs while at `suggest`.
 * Recorded in history with `automatic: true`. Idempotent otherwise.
 */
export function promoteIfEarned(options: {
  overlayDir: string;
  name: string;
  at: number;
}): ToolLifecycle {
  const data = loadLifecycle(options.overlayDir);
  const tool = requireTool(data, options.name);
  if (tool.tier !== 'suggest' || tool.cleanRuns < N_CLEAN_RUNS_FOR_ADVISORY) return tool;
  const promoted: ToolLifecycle = { ...tool, tier: 'advisory' };
  data.tools[options.name] = promoted;
  data.history.push({
    at: options.at,
    tool: options.name,
    event: 'promoted',
    from: 'suggest',
    to: 'advisory',
    automatic: true,
  });
  saveLifecycle(options.overlayDir, data);
  return promoted;
}

/**
 * Promote to `enforce` — the only path there, and it requires human
 * ratification (spec §5.6: "enforce only with human ratification").
 * Missing/blank ratifiedBy → RatificationRequiredError. The tool must
 * already hold `advisory`; the ladder is climbed one rung at a time.
 */
export function promote(options: {
  overlayDir: string;
  name: string;
  to: 'enforce';
  ratifiedBy: string;
  at?: number;
}): ToolLifecycle {
  if (typeof options.ratifiedBy !== 'string' || options.ratifiedBy.trim() === '') {
    throw new RatificationRequiredError('promote to enforce');
  }
  const data = loadLifecycle(options.overlayDir);
  const tool = requireTool(data, options.name);
  if (tool.tier !== 'advisory') {
    throw new LadderOrderError(tool.tier);
  }
  const at = options.at ?? Date.now();
  const promoted: ToolLifecycle = { ...tool, tier: 'enforce' };
  data.tools[options.name] = promoted;
  data.history.push({
    at,
    tool: options.name,
    event: 'promoted',
    from: 'advisory',
    to: 'enforce',
    ratifiedBy: options.ratifiedBy,
  });
  saveLifecycle(options.overlayDir, data);
  return promoted;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function decayOne(data: LifecycleFile, tool: ToolLifecycle, now: number): LifecycleEvent | null {
  const anchor = Math.max(tool.lastUsedAt, tool.decayedAt ?? 0);
  if (now - anchor <= RATIFIED_SANDBOX_PROFILE.decayWindowDays * DAY_MS) return null;
  if (tool.tier === 'suggest') {
    if (tool.status === 'removal_proposed') return null;
    data.tools[tool.name] = { ...tool, status: 'removal_proposed', decayedAt: now };
    return { at: now, tool: tool.name, event: 'removal_proposed', automatic: true };
  }
  const to: WorkshopTier = tool.tier === 'enforce' ? 'advisory' : 'suggest';
  data.tools[tool.name] = { ...tool, tier: to, decayedAt: now, cleanRuns: 0 };
  return { at: now, tool: tool.name, event: 'decayed', from: tool.tier, to, automatic: true };
}

/**
 * Decay sweep (spec §5.6 auto-decay). A tool unused for longer than the
 * ratified decayWindowDays (30) since its last run — or since its last
 * demotion, so one idle stretch costs one rung per window, not a free-fall —
 * is demoted one tier and marked (`decayedAt`). A tool already at `suggest`
 * and still unused gets status `removal_proposed`; the removal itself still
 * requires retire() with ratifiedBy. Returns the transitions applied.
 */
export function sweepDecay(options: { overlayDir: string; now: number }): LifecycleEvent[] {
  const data = loadLifecycle(options.overlayDir);
  const events: LifecycleEvent[] = [];
  for (const tool of Object.values(data.tools)) {
    const event = decayOne(data, tool, options.now);
    if (event !== null) events.push(event);
  }
  if (events.length > 0) {
    data.history.push(...events);
    saveLifecycle(options.overlayDir, data);
  }
  return events;
}

/** Record a retirement (called by retire(); ratifiedBy already verified). */
export function recordRetirement(options: {
  overlayDir: string;
  name: string;
  ratifiedBy: string;
  at: number;
}): void {
  const data = loadLifecycle(options.overlayDir);
  delete data.tools[options.name];
  data.history.push({
    at: options.at,
    tool: options.name,
    event: 'retired',
    ratifiedBy: options.ratifiedBy,
  });
  saveLifecycle(options.overlayDir, data);
}
