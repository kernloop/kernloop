/**
 * The per-repo overlay (spec §7): `.kernloop/` holds the repo's kernloop
 * identity as data. P2 layout — `overlay.yaml` (id, budgets, brief token
 * cap, gate thresholds, the K vote-iterate bound, node overrides),
 * `audit.jsonl` (append-only chain), `memory.sqlite` (episodic + semantic
 * stores). The sqlite file is gitignored per the spec §12.4 recommendation
 * (privacy over portability); claims/, skills/, workshop/, priors.yaml
 * arrive with the faculties that own them (P3) — absent from the schema by
 * design, not stubbed.
 *
 * Precedence contract: values in `overlay.yaml` win over schema defaults;
 * defaults are applied at parse time, so a loaded {@link Overlay} is always
 * fully populated. Node overrides win over a node's declared configuration —
 * resolved only through {@link gateForNode} / {@link specialistsForNode},
 * never by consumers reading `nodeOverrides` raw.
 *
 * Strictness: every object is `strictObject` — unknown keys are rejected.
 * A typo'd knob that parses silently would let the file lie about behavior
 * (prime directive); P3 keys (priors, skills, workshop config) are rejected
 * until the faculty that reads them exists.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EffortSchema, ModelTierSchema, type ModelRequirement } from '@kernloop/contracts';
import { ADAPTER_NAMES, resolveTierModel } from '@kernloop/kernel';
import { BudgetModeSchema } from '@kernloop/workflows';
import { z } from 'zod';
import YAML from 'yaml';
import { EndpointsSchema } from './endpoints.js';
import { TrackerSchema } from './tracker-config.js';
import { overlayTemplate } from './overlay-template.js';

/** Name of the overlay directory committed with each repo (spec §7). */
export const OVERLAY_DIR_NAME = '.kernloop';

/** Resolved file layout of one overlay directory. */
export interface OverlayPaths {
  /** The `.kernloop/` directory itself. */
  readonly dir: string;
  /** Repo root the overlay belongs to (parent of `.kernloop/`). */
  readonly repoRoot: string;
  /** Append-only JSONL audit chain (spec §3.3). */
  readonly audit: string;
  /** Repo-local SQLite memory database (spec §3.3, §7). */
  readonly memory: string;
  /** Repo-local SQLite job registry (spec §3.4: status async/cross-session). */
  readonly jobs: string;
  /** Repo-local SQLite program ledger (spec §5.4: resumable, poll-driven). */
  readonly programs: string;
  /** Overlay configuration: id, budgets, gate thresholds, K, overrides. */
  readonly config: string;
  /** Exported, reviewable learned routing priors (spec §7 priors.yaml). */
  readonly priors: string;
  /** Machine-local discovered model catalog (spec §5.7 discovery) — gitignored. */
  readonly modelsCache: string;
}

/** Resolve the overlay file layout for an overlay directory. */
export function overlayPaths(overlayDir: string): OverlayPaths {
  const dir = path.resolve(overlayDir);
  return {
    dir,
    repoRoot: path.dirname(dir),
    audit: path.join(dir, 'audit.jsonl'),
    memory: path.join(dir, 'memory.sqlite'),
    jobs: path.join(dir, 'jobs.sqlite'),
    programs: path.join(dir, 'programs.sqlite'),
    config: path.join(dir, 'overlay.yaml'),
    priors: path.join(dir, 'priors.yaml'),
    modelsCache: path.join(dir, 'models-cache.json'),
  };
}

/** Consensus strategies in use for the P2 vote gate (spec §12.3 proposal). */
export const VOTE_STRATEGIES = ['simple_majority', 'supermajority', 'unanimous'] as const;

/** Legal vote panel sizes: 3 by default, 7 at plan ratification (spec §8.6). */
export const VOTE_PANEL_SIZES = [3, 7] as const;

/** Task budgets — each a positive ceiling; a 0-budget is a lie, not a cap. */
const BudgetsSchema = z.strictObject({
  tokens: z.number().int().positive().default(100_000),
  usd: z.number().positive().default(1),
  wallClockMin: z.number().positive().default(30),
});

/** Vote-gate thresholds (spec §5.3, §8.6): strategy is data, panel 3 or 7. */
const VoteGateSchema = z.strictObject({
  strategy: z.enum(VOTE_STRATEGIES).default('simple_majority'),
  panel: z.union([z.literal(3), z.literal(7)]).default(3),
});

/** Quality-gate knobs; the per-check timeout has no honest overlay default — the gate owns it. */
const QualityGateSchema = z.strictObject({
  timeoutMsPerCheck: z.number().int().positive().optional(),
});

/** Gate thresholds, keyed by gate. Review-gate knobs are P3 — absent. */
const GatesSchema = z.strictObject({
  vote: VoteGateSchema.prefault({}),
  quality: QualityGateSchema.prefault({}),
});

/**
 * One node override (spec §6: "Overlays may override nodes (swap a gate,
 * add a specialist) — never duplicate the graph"). P2 scopes this narrowly:
 *
 * - `gate` — swap which registered gate a gate node runs (e.g. point the
 *   loop's quality node at a repo-specific gate name).
 * - `specialists` — workforce template names added to the fan-out node's
 *   children.
 * - `tier` / `effort` — override the model REQUIREMENT a model-calling node
 *   derives from its template/manifest (spec §8.4). A node may raise or lower
 *   either axis without forking the template; the loop resolves the overridden
 *   requirement through the kernel translation seam exactly as a declared one.
 *
 * Deliberately absent: `skip` (a node you can turn off is a fail-closed
 * path), edge rewiring, and node duplication — the graph itself is not
 * overlay data. An empty override is rejected: it hides intent.
 */
export const NodeOverrideSchema = z
  .strictObject({
    gate: z.string().min(1).optional(),
    specialists: z.array(z.string().min(1)).optional(),
    tier: ModelTierSchema.optional(),
    effort: EffortSchema.optional(),
  })
  .refine(
    (o) =>
      o.gate !== undefined ||
      o.specialists !== undefined ||
      o.tier !== undefined ||
      o.effort !== undefined,
    {
      message:
        'a node override must set gate, specialists, tier, and/or effort — an empty override hides intent',
    },
  );
export type NodeOverride = z.infer<typeof NodeOverrideSchema>;

/**
 * Per-tier model adapters (spec §8.4 cost lever [CLM-0078]): which adapter the
 * loop binds for each model {@link ModelTierSchema} tier (frontier/large/
 * medium/small). EVERY key is optional — an unset tier falls back to the run's
 * `--adapter`, so an overlay with no `adapters` block is byte-identical to the
 * single-adapter behavior (the backward-compat guarantee). Each value is one of
 * the five kernel adapter names. Consumed only at the loop composition root
 * (loop/index.ts), never by the Router — see loop/node-model.ts for the
 * loop-vs-Router honesty note.
 */
const AdaptersSchema = z.strictObject({
  frontier: z.string().min(1).optional(),
  large: z.string().min(1).optional(),
  medium: z.string().min(1).optional(),
  small: z.string().min(1).optional(),
});
export type TierAdapters = z.infer<typeof AdaptersSchema>;

/** True when `name` is one of the five built-in CLI adapters (vs an endpoint id). */
export function isCliAdapter(name: string): name is (typeof ADAPTER_NAMES)[number] {
  return (ADAPTER_NAMES as readonly string[]).includes(name);
}

/**
 * overlay.yaml schema (spec §7: "gate thresholds, K, budgets, node
 * overrides"). K is the vote-iterate bound — rejected plans loop at most K
 * times before escalating to the human (spec §6; default 3 adopted per
 * §12.2). Every field except `id` defaults, so a minimal overlay is just an
 * id; file values win over defaults (precedence, see module docs).
 */
export const OverlaySchema = z
  .strictObject({
    id: z.string().min(1),
    budgets: BudgetsSchema.prefault({}),
    briefTokens: z.number().int().positive().default(4_000),
    /** Per-call model-invoke timeout (ms) base for the loop's generative nodes
     * [CLM-0078, #127]; absent → 15-min default, lighter nodes capped shorter.
     * Raise it when a real cross-file implement step needs longer (node-model.ts). */
    invokeTimeoutMs: z.number().int().positive().optional(),
    K: z.number().int().min(1).default(3),
    /**
     * Child-iterate bound (spec §6, §8) [CLM-0043]: a child's implement re-runs
     * at most Kc times on a quality reject before the child escalates. Bounds
     * child iteration in BOTH budget modes — unlimited budget is not unlimited
     * iterations; raising Kc is how you allow more.
     */
    Kc: z.number().int().min(1).default(3),
    /**
     * Budget enforcement mode (spec §8) [CLM-0077]: `enforce` (default) HALTS a
     * run whose metered spend exceeds the parent budget; `unlimited` lifts the
     * restriction but NOT the tracking — usage/cost is metered and reported
     * identically in both modes. A run-level `--unlimited` override forces
     * `unlimited` regardless of this default.
     */
    budgetMode: BudgetModeSchema.default('enforce'),
    gates: GatesSchema.prefault({}),
    nodeOverrides: z.record(z.string().min(1), NodeOverrideSchema).default({}),
    adapters: AdaptersSchema.optional(),
    /**
     * Registered OpenAI-compatible HTTP endpoints (spec §8.4 `api` adapter), keyed
     * by id. The per-tier `adapters` map may name an endpoint id (vs a CLI name);
     * the loop then calls that endpoint via the kernel `invokeApiAdapter`, metered
     * into the run budget. The key VALUE is NEVER stored here — only the NAME of
     * an env var (`apiKeyEnv`); a literal key is rejected at parse (see endpoints.ts).
     */
    endpoints: EndpointsSchema.default({}),
    /** Issue-tracker config (spec §5.5) [CLM-0093]; see {@link TrackerSchema}. */
    tracker: TrackerSchema.optional(),
  })
  .superRefine((overlay, ctx) => {
    // Every per-tier adapter must be a built-in CLI name OR a registered endpoint id.
    for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
      const name = overlay.adapters?.[tier];
      if (name === undefined || isCliAdapter(name)) continue;
      const endpoint = overlay.endpoints[name];
      if (endpoint === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['adapters', tier],
          message:
            `adapters.${tier} "${name}" is neither a built-in adapter ` +
            `(${ADAPTER_NAMES.join(', ')}) nor a registered endpoint id — register it under endpoints`,
        });
        continue;
      }
      // Fail FAST, not mid-loop: an endpoint pointed at a tier it serves no model
      // for resolves to the empty model id at call time — fatal for an api endpoint
      // (no harness default), so reject it at config time, naming tier + endpoint.
      if (resolveTierModel(tier, endpoint.models).model === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['adapters', tier],
          message:
            `adapters.${tier} "${name}" serves no model for the ${tier} tier (or one below) — ` +
            `add a models entry for ${tier} (or a lower tier) under endpoints.${name}`,
        });
      }
    }
  });
export type Overlay = z.infer<typeof OverlaySchema>;

/** Typed failure loading or validating an overlay; schema failures carry the zod issues. */
export class OverlayError extends Error {
  /** Structured zod issues (empty for YAML-level failures) — doctor surfaces these. */
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message);
    this.name = 'OverlayError';
    this.issues = issues;
  }
}

/**
 * Load and validate `overlay.yaml` under `overlayDir`, applying defaults
 * (file values win). A missing file yields the defaults with the overlay id
 * derived from the repo directory name — `kernloop init` writes the file;
 * until then the derived identity is reported, never fabricated as committed
 * config. Malformed YAML or a schema violation throws {@link OverlayError}.
 */
export function loadOverlay(overlayDir: string): Overlay {
  const paths = overlayPaths(overlayDir);
  if (!existsSync(paths.config)) {
    return OverlaySchema.parse({ id: path.basename(paths.repoRoot) });
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(paths.config, 'utf8'));
  } catch (error) {
    throw new OverlayError(
      `overlay.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = OverlaySchema.safeParse(raw);
  if (!result.success) {
    throw new OverlayError(
      `overlay.yaml is invalid: ${z.prettifyError(result.error)}`,
      result.error.issues,
    );
  }
  return result.data;
}

/**
 * The gate a loop node runs: a node override's `gate` wins over the node's
 * declared gate (spec §6 "swap a gate"). Pure precedence — the loop engine
 * validates the resolved name against registered gates at wiring time.
 */
export function gateForNode(overlay: Overlay, node: string, declaredGate: string): string {
  return overlay.nodeOverrides[node]?.gate ?? declaredGate;
}

/** Specialist templates the overlay adds to a fan-out node (spec §6 "add a specialist"). */
export function specialistsForNode(overlay: Overlay, node: string): readonly string[] {
  return overlay.nodeOverrides[node]?.specialists ?? [];
}

/**
 * Apply a node override's `tier`/`effort` onto a node's DERIVED model
 * requirement (spec §8.4) — the override wins per axis, each axis independent;
 * an unset axis keeps the template/manifest-declared value. Pure precedence,
 * mirroring {@link gateForNode}; the loop resolves the result through the
 * kernel translation seam.
 */
export function requirementForNode(
  overlay: Overlay,
  node: string,
  derived: ModelRequirement,
): ModelRequirement {
  const override = overlay.nodeOverrides[node];
  if (override === undefined || (override.tier === undefined && override.effort === undefined)) {
    return derived;
  }
  return {
    ...derived,
    ...(override.tier === undefined ? {} : { tier: override.tier }),
    ...(override.effort === undefined ? {} : { effort: override.effort }),
  };
}

/** What `initOverlay` did, file by file. */
export interface InitResult {
  readonly overlayDir: string;
  readonly created: string[];
  readonly skipped: string[];
}

/**
 * `kernloop init` (spec §7): scaffold `.kernloop/` with an `overlay.yaml`
 * and a `.gitignore` excluding `memory.sqlite` (spec §12.4 recommendation:
 * gitignore + export/import rather than committing the database). Existing
 * files are never overwritten. `audit.jsonl` is created by the first audit
 * append, not scaffolded empty.
 */
export function initOverlay(repoRoot: string): InitResult {
  const paths = overlayPaths(path.join(repoRoot, OVERLAY_DIR_NAME));
  const created: string[] = [];
  const skipped: string[] = [];
  mkdirSync(paths.dir, { recursive: true });
  const defaults = OverlaySchema.parse({ id: path.basename(paths.repoRoot) });
  const files: Array<[string, string]> = [
    [paths.config, overlayTemplate(defaults)],
    [
      path.join(paths.dir, '.gitignore'),
      // spec §12.4: gitignore machine-local state (privacy over portability) —
      // the memory DB, job registry, program ledger, loop checkpoints, model
      // cache. The `*` after each .sqlite also covers WAL sidecars (-wal/-shm, #157).
      'memory.sqlite*\njobs.sqlite*\nprograms.sqlite*\ncheckpoints/\nmodels-cache.json\n',
    ],
  ];
  for (const [file, content] of files) {
    if (existsSync(file)) {
      skipped.push(file);
    } else {
      writeFileSync(file, content, 'utf8');
      created.push(file);
    }
  }
  return { overlayDir: paths.dir, created, skipped };
}
