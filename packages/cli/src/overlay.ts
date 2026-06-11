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
import { ADAPTER_NAMES } from '@kernloop/kernel';
import { z } from 'zod';
import YAML from 'yaml';

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
  /** Overlay configuration: id, budgets, gate thresholds, K, overrides. */
  readonly config: string;
}

/** Resolve the overlay file layout for an overlay directory. */
export function overlayPaths(overlayDir: string): OverlayPaths {
  const dir = path.resolve(overlayDir);
  return {
    dir,
    repoRoot: path.dirname(dir),
    audit: path.join(dir, 'audit.jsonl'),
    memory: path.join(dir, 'memory.sqlite'),
    config: path.join(dir, 'overlay.yaml'),
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
 *
 * Deliberately absent: `skip` (a node you can turn off is a fail-closed
 * path), edge rewiring, and node duplication — the graph itself is not
 * overlay data. An empty override is rejected: it hides intent.
 */
export const NodeOverrideSchema = z
  .strictObject({
    gate: z.string().min(1).optional(),
    specialists: z.array(z.string().min(1)).optional(),
  })
  .refine((o) => o.gate !== undefined || o.specialists !== undefined, {
    message: 'a node override must set gate and/or specialists — an empty override hides intent',
  });
export type NodeOverride = z.infer<typeof NodeOverrideSchema>;

/**
 * Tiered model adapters (spec §8.4 cost lever [CLM-0068]): the adapter the
 * loop binds for each declared node tier. BOTH keys are optional — when a
 * tier is unset, the loop falls back to the run's `--adapter`, so an overlay
 * with no `adapters` block is byte-identical to today's single-adapter
 * behavior (the backward-compat guarantee). Each value is one of the five
 * kernel adapter names. The map is consumed only at the loop composition root
 * (loop/index.ts), never by the Router — see loop/tiers.ts for the
 * loop-vs-Router honesty note.
 */
const AdaptersSchema = z.strictObject({
  cheap: z.enum(ADAPTER_NAMES).optional(),
  frontier: z.enum(ADAPTER_NAMES).optional(),
});
export type TierAdapters = z.infer<typeof AdaptersSchema>;

/**
 * overlay.yaml schema (spec §7: "gate thresholds, K, budgets, node
 * overrides"). K is the vote-iterate bound — rejected plans loop at most K
 * times before escalating to the human (spec §6; default 3 adopted per
 * §12.2). Every field except `id` defaults, so a minimal overlay is just an
 * id; file values win over defaults (precedence, see module docs).
 */
export const OverlaySchema = z.strictObject({
  id: z.string().min(1),
  budgets: BudgetsSchema.prefault({}),
  briefTokens: z.number().int().positive().default(4_000),
  K: z.number().int().min(1).default(3),
  gates: GatesSchema.prefault({}),
  nodeOverrides: z.record(z.string().min(1), NodeOverrideSchema).default({}),
  adapters: AdaptersSchema.optional(),
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

/** What `initOverlay` did, file by file. */
export interface InitResult {
  readonly overlayDir: string;
  readonly created: string[];
  readonly skipped: string[];
}

/** Render the overlay.yaml template `kernloop init` writes (spec-true defaults, commented). */
function overlayTemplate(defaults: Overlay): string {
  return [
    '# kernloop overlay (spec §7) — per-repo identity as data',
    `id: ${defaults.id}`,
    'budgets:',
    `  tokens: ${String(defaults.budgets.tokens)}`,
    `  usd: ${String(defaults.budgets.usd)}`,
    `  wallClockMin: ${String(defaults.budgets.wallClockMin)}`,
    `briefTokens: ${String(defaults.briefTokens)}`,
    '# vote-iterate bound: rejected plans loop at most K times, then escalate to the human (spec §6)',
    `K: ${String(defaults.K)}`,
    'gates:',
    '  vote:',
    `    strategy: ${defaults.gates.vote.strategy} # simple_majority | supermajority | unanimous`,
    `    panel: ${String(defaults.gates.vote.panel)} # 3 default; 7 at plan ratification (spec §8.6)`,
    '#  quality:',
    '#    timeoutMsPerCheck: 120000',
    '# adapters:  # tiered model adapters (spec §8.4) — cheap for research/review, frontier for plan/vote/decompose/implement',
    '#   cheap: codex      # any of: claude codex gemini opencode ollama; unset → falls back to --adapter',
    '#   frontier: claude  # unset → falls back to --adapter (so no adapters block = single-adapter behavior)',
    "# nodeOverrides:  # swap a gate node's gate / add fanout specialists (spec §6) — never duplicate the graph",
    '#  canonical node names: frame research plan vote decompose fanout integrate retrospect (children: implement quality)',
    '#   quality: { gate: security-review }',
    '#   fanout: { specialists: [researcher] }',
    '',
  ].join('\n');
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
      '# spec §12.4: gitignore the memory database (privacy over portability)\n' +
        'memory.sqlite\n' +
        '# loop run checkpoints are machine-local, never repo identity\n' +
        'checkpoints/\n',
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
