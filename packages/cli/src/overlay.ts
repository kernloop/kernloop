/**
 * The per-repo overlay (spec §7): `.kernloop/` holds the repo's kernloop
 * identity as data. P1 layout — `overlay.yaml` (config), `audit.jsonl`
 * (append-only chain), `memory.sqlite` (episodic + semantic stores). The
 * sqlite file is gitignored per the spec §12.4 recommendation (privacy over
 * portability); claims/, skills/, workshop/, priors.yaml arrive with the
 * faculties that own them (P2/P3) — absent here by design, not stubbed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  /** Overlay configuration: id, budgets, brief token cap. */
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

/**
 * overlay.yaml schema (spec §7: "gate thresholds, K, budgets, node
 * overrides" — the P1 subset is the overlay id, default task budgets, and
 * the brief token cap; gate/loop knobs arrive with the P2 loop).
 */
export const OverlayConfigSchema = z.object({
  id: z.string().min(1),
  budgets: z
    .object({
      tokens: z.number().int().nonnegative().default(100_000),
      usd: z.number().nonnegative().default(1),
      wallClockMin: z.number().nonnegative().default(30),
    })
    .default({ tokens: 100_000, usd: 1, wallClockMin: 30 }),
  briefTokens: z.number().int().nonnegative().default(4_000),
});
export type OverlayConfig = z.infer<typeof OverlayConfigSchema>;

/** Typed failure loading or validating an overlay. */
export class OverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayError';
  }
}

/**
 * Load and validate `overlay.yaml`. A missing file yields the defaults with
 * the overlay id derived from the repo directory name — `kernloop init`
 * writes the file; until then the derived identity is reported, never
 * fabricated as committed config.
 */
export function loadOverlayConfig(paths: OverlayPaths): OverlayConfig {
  if (!existsSync(paths.config)) {
    return OverlayConfigSchema.parse({ id: path.basename(paths.repoRoot) });
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(paths.config, 'utf8'));
  } catch (error) {
    throw new OverlayError(
      `overlay.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = OverlayConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new OverlayError(`overlay.yaml is invalid: ${z.prettifyError(result.error)}`);
  }
  return result.data;
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
  const defaults = OverlayConfigSchema.parse({ id: path.basename(paths.repoRoot) });
  const files: Array<[string, string]> = [
    [
      paths.config,
      [
        '# kernloop overlay (spec §7) — per-repo identity as data',
        `id: ${defaults.id}`,
        'budgets:',
        `  tokens: ${String(defaults.budgets.tokens)}`,
        `  usd: ${String(defaults.budgets.usd)}`,
        `  wallClockMin: ${String(defaults.budgets.wallClockMin)}`,
        `briefTokens: ${String(defaults.briefTokens)}`,
        '',
      ].join('\n'),
    ],
    [
      path.join(paths.dir, '.gitignore'),
      '# spec §12.4: gitignore the memory database (privacy over portability)\nmemory.sqlite\n',
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
