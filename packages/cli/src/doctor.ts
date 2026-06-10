/**
 * `kernloop doctor` — validate one overlay (spec §7: "`kernloop init`
 * scaffolds it; `kernloop doctor` validates it"). Checks: the overlay
 * directory exists, `overlay.yaml` parses against {@link OverlaySchema}
 * (zod issues surfaced verbatim), K ≥ 1, vote panel ∈ {3, 7}, budgets
 * positive, the audit chain verifies end to end, and the memory database
 * opens. The K/panel/budget checks read the raw YAML so each misconfigured
 * knob gets its own named, targeted failure alongside the schema verdict.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import YAML from 'yaml';
import { createAuditStore, verifyChain } from '@kernloop/kernel';
import { createMemory } from '@kernloop/faculty-memory';
import { OverlaySchema, overlayPaths, type OverlayPaths } from './overlay.js';

/** One doctor check result. */
export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** What `doctor` returns. */
export interface DoctorResult {
  readonly ok: boolean;
  readonly overlayDir: string;
  readonly checks: DoctorCheck[];
}

/** Walk a raw parsed-YAML value by key path; undefined when the path is absent. */
function at(raw: unknown, ...keys: string[]): unknown {
  let current = raw;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** K (vote-iterate bound, spec §6): integer ≥ 1; absent means the default 3. */
function checkK(raw: unknown): DoctorCheck {
  const k = at(raw, 'K');
  if (k === undefined) return { name: 'K bound', ok: true, detail: 'K = 3 (default, spec §6)' };
  if (typeof k === 'number' && Number.isInteger(k) && k >= 1) {
    return { name: 'K bound', ok: true, detail: `K = ${String(k)}` };
  }
  return {
    name: 'K bound',
    ok: false,
    detail: `K must be an integer ≥ 1 (vote-iterate bound, spec §6), got ${JSON.stringify(k)}`,
  };
}

/** Vote panel (spec §8.6): 3 or 7; absent means the default 3. */
function checkVotePanel(raw: unknown): DoctorCheck {
  const panel = at(raw, 'gates', 'vote', 'panel');
  if (panel === undefined) {
    return { name: 'vote panel', ok: true, detail: 'panel = 3 (default)' };
  }
  if (panel === 3 || panel === 7) {
    return { name: 'vote panel', ok: true, detail: `panel = ${String(panel)}` };
  }
  return {
    name: 'vote panel',
    ok: false,
    detail: `vote panel must be 3 or 7 (spec §8.6), got ${JSON.stringify(panel)}`,
  };
}

/** Budgets: every declared ceiling must be a positive number; absent fields default. */
function checkBudgets(raw: unknown): DoctorCheck {
  const bad: string[] = [];
  for (const key of ['tokens', 'usd', 'wallClockMin'] as const) {
    const value = at(raw, 'budgets', key);
    if (value !== undefined && !(typeof value === 'number' && value > 0)) {
      bad.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  if (bad.length > 0) {
    return { name: 'budgets', ok: false, detail: `budgets must be positive: ${bad.join(', ')}` };
  }
  return { name: 'budgets', ok: true, detail: 'declared budgets positive (absent ones default)' };
}

/**
 * The config check family: overlay.yaml existence, YAML parse, schema
 * validation, then the targeted K/panel/budget checks against the raw
 * document. Missing or unparseable files end the family early — there is
 * nothing honest to check knobs against.
 */
function configChecks(paths: OverlayPaths): DoctorCheck[] {
  if (!existsSync(paths.config)) {
    return [{ name: 'overlay.yaml', ok: false, detail: 'missing — run `kernloop init`' }];
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(paths.config, 'utf8'));
  } catch (error) {
    return [
      {
        name: 'overlay.yaml',
        ok: false,
        detail: `not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
  const parsed = OverlaySchema.safeParse(raw);
  const schemaCheck: DoctorCheck = parsed.success
    ? { name: 'overlay.yaml', ok: true, detail: `overlay id "${parsed.data.id}"` }
    : { name: 'overlay.yaml', ok: false, detail: `invalid: ${z.prettifyError(parsed.error)}` };
  return [schemaCheck, checkK(raw), checkVotePanel(raw), checkBudgets(raw)];
}

/** Verify the audit chain; an absent file is a valid chain of length 0. */
function checkAudit(paths: OverlayPaths): DoctorCheck {
  const result = verifyChain(createAuditStore(paths.audit));
  return result.ok
    ? { name: 'audit chain', ok: true, detail: `verified, ${String(result.length)} event(s)` }
    : {
        name: 'audit chain',
        ok: false,
        detail: `${result.reason} at seq ${String(result.seq)}: ${result.detail}`,
      };
}

/** Open (and close) the memory database. */
function checkMemory(paths: OverlayPaths): DoctorCheck {
  try {
    const memory = createMemory(paths.memory);
    const traces = memory.listSummaries({ limit: 1 }).length;
    memory.close();
    return {
      name: 'memory.sqlite',
      ok: true,
      detail: traces > 0 ? 'opens, has traces' : 'opens',
    };
  } catch (error) {
    return {
      name: 'memory.sqlite',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Run every doctor check over the overlay under `repoRoot/.kernloop`. */
export function doctor(overlayDir: string): DoctorResult {
  const paths = overlayPaths(overlayDir);
  if (!existsSync(paths.dir)) {
    return {
      ok: false,
      overlayDir: paths.dir,
      checks: [
        {
          name: 'overlay dir',
          ok: false,
          detail: `${paths.dir} does not exist — run \`kernloop init\``,
        },
      ],
    };
  }
  const checks = [
    { name: 'overlay dir', ok: true, detail: paths.dir },
    ...configChecks(paths),
    checkAudit(paths),
    checkMemory(paths),
  ];
  return { ok: checks.every((c) => c.ok), overlayDir: paths.dir, checks };
}
