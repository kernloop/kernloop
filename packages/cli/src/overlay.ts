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
import { type ModelRequirement } from '@kernloop/contracts';
import { ADAPTER_NAMES, resolveTierModel } from '@kernloop/kernel';
import { BudgetModeSchema } from '@kernloop/workflows';
import { z } from 'zod';
import YAML from 'yaml';
import { EndpointsSchema, ownKeyedEndpoints } from './endpoints.js';
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

// Overlay sub-schemas live in ./overlay-schemas.ts (#252 — keep this module under
// its LOC budget). Imported for use in OverlaySchema below; the public symbols are
// re-exported (with source, so the API resolver chases them) so existing
// `from '../overlay.js'` imports are unchanged.
import {
  AdapterFitnessSchema,
  AdapterModelsSchema,
  AdaptersSchema,
  BudgetsSchema,
  GatesSchema,
  NodeOverrideSchema,
  RouterSchema,
  isCliAdapter,
  tierCandidates,
} from './overlay-schemas.js';
export {
  NodeOverrideSchema,
  VOTE_PANEL_SIZES,
  VOTE_STRATEGIES,
  adapterModelOverride,
  isCliAdapter,
  type AdapterModels,
  type NodeOverride,
  type TierAdapters,
} from './overlay-schemas.js';

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
     * Pre-node budget reserve floor as a FRACTION of the parent budget (#342): in
     * enforce mode the run halts BEFORE a node when remaining < max(this × limit,
     * largest-node-seen), so the cap is a near-ceiling instead of overshooting by
     * one node's spend. The floor covers COLD START (the first node). Default 0 —
     * observed-max alone caps steady-state overshoot; raise this to also bound the
     * first node.
     */
    budgetHeadroomFraction: z.number().min(0).max(1).default(0),
    /**
     * Budget enforcement mode (spec §8) [CLM-0077]: `enforce` (default) HALTS a
     * run whose metered spend exceeds the parent budget; `unlimited` lifts the
     * restriction but NOT the tracking — usage/cost is metered and reported
     * identically in both modes. A run-level `--unlimited` override forces
     * `unlimited` regardless of this default.
     */
    budgetMode: BudgetModeSchema.default('enforce'),
    /**
     * Budget-aware model DOWNGRADE (spec §8.4 cost lever, #194) [CLM-0119]: once
     * a run's metered spend reaches `atSpendFraction` of its budget, the nodes
     * that run AFTER that point route one model tier LOWER (frontier→large→
     * medium→small) — a cheaper finish instead of halting at the cap. Absent →
     * no downgrade (byte-identical to today). Orthogonal to `budgetMode`: an
     * `enforce` run still HALTS at 1.0 of budget; the downgrade just makes the
     * approach to that cap cheaper. Never an upgrade; recorded in provenance + a
     * `cli.loop.downgrade` audit event.
     */
    downgrade: z.strictObject({ atSpendFraction: z.number().gt(0).lte(1) }).optional(),
    gates: GatesSchema.prefault({}),
    router: RouterSchema.prefault({}), // seed routing from the reviewed priors.yaml [CLM-0126]
    adapterFitness: AdapterFitnessSchema.prefault({}), // live identity-fitness adapter pick [CLM-0130]
    nodeOverrides: z.record(z.string().min(1), NodeOverrideSchema).default({}),
    adapters: AdaptersSchema.optional(),
    adapterModels: AdapterModelsSchema.optional(), // pin a CLI adapter's per-tier model [CLM-0166, #393]
    /**
     * Registered OpenAI-compatible HTTP endpoints (spec §8.4 `api` adapter), keyed
     * by id. The per-tier `adapters` map may name an endpoint id (vs a CLI name);
     * the loop then calls that endpoint via the kernel `invokeApiAdapter`, metered
     * into the run budget. The key VALUE is NEVER stored here — only the NAME of
     * an env var (`apiKeyEnv`); a literal key is rejected at parse (see endpoints.ts).
     */
    // Null-prototype the registered-endpoint map (#474) so `endpoints[name]` membership
    // checks across the cli cannot be defeated by a prototype-inherited adapter name
    // (`constructor`, `toString`, …) — a lexical `=== undefined` on a plain object would
    // misclassify such a name as a registered endpoint. The transform runs on BOTH the
    // parsed map and the `{}` default, so every consumer reads an own-keys-only object.
    endpoints: EndpointsSchema.default({}).transform(ownKeyedEndpoints),
    /**
     * Extra env-var NAMES handed to a spawned model-CLI child beyond the benign
     * base allowlist (#227, CLM-0122). A spawned CLI receives ONLY the kernel's
     * SAFE_ENV_KEYS (PATH/HOME/locale/tmp/XDG…) plus these names — never the full
     * host env — so other providers' keys, `GH_TOKEN`, and cloud creds are not
     * exposed to a third-party agentic binary. A login-authenticated CLI needs
     * none of these (it reads HOME); a key-authenticated one names its key var
     * here (e.g. `ANTHROPIC_API_KEY`). These are env-var NAMES, not values: a
     * stray literal value placed here is inert — it matches no env var and is
     * dropped, so it is never passed to the child (it is not actively rejected,
     * just useless). The actual secret lives in your shell env, never here.
     */
    adapterEnvAllow: z.array(z.string().min(1)).default([]),
    /** Issue-tracker config (spec §5.5) [CLM-0093]; see {@link TrackerSchema}. */
    tracker: TrackerSchema.optional(),
  })
  .superRefine((overlay, ctx) => {
    // Every per-tier adapter CANDIDATE must be a built-in CLI name OR a
    // registered endpoint id (a tier may now list multiple candidates, #252).
    for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
      for (const name of tierCandidates(overlay.adapters, tier)) {
        if (isCliAdapter(name)) continue;
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
