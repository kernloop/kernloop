/**
 * The workshop namespace (spec §5.6; CLM-0053). Every toolsmith creation
 * lives under `<overlayDir>/workshop/<name>/` — physically under the
 * overlay, never in kernel or faculty packages. Names are path-traversal
 * guarded; retirement is human-ratified and preserves history under
 * `workshop/.retired/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Manifest } from '@kernloop/contracts';
import { RatificationRequiredError, UnknownToolError, WorkshopNameError } from './errors.js';
import { recordRetirement } from './lifecycle.js';

/** Directory under the overlay that holds all live workshop tools. */
export const WORKSHOP_DIR = 'workshop';
/** Subdirectory holding retired tools — history preserved, never deleted. */
export const RETIRED_DIR = '.retired';
/**
 * Safe tool directory names: the segment after `workshop/` in the manifest
 * name. Lowercase alphanumerics and hyphens only — no separators, no dots,
 * so `..`, absolute paths, and hidden dirs are unrepresentable.
 */
export const SAFE_TOOL_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** One live workshop tool as found on disk. */
export interface WorkshopToolInfo {
  /** Short tool name (the directory name under workshop/). */
  readonly name: string;
  /** Absolute path of the tool directory. */
  readonly dir: string;
  /** The tool's installed manifest. */
  readonly manifest: Manifest;
}

/** Absolute path of the overlay's workshop directory. */
export function workshopDir(overlayDir: string): string {
  return path.join(path.resolve(overlayDir), WORKSHOP_DIR);
}

/**
 * Absolute path of one tool's directory, with the traversal guard applied.
 * Throws WorkshopNameError for any name that is not a safe single segment.
 */
export function toolDir(overlayDir: string, name: string): string {
  if (!SAFE_TOOL_NAME.test(name)) {
    throw new WorkshopNameError(name);
  }
  return path.join(workshopDir(overlayDir), name);
}

/**
 * List the live tools in an overlay's workshop: directories (excluding
 * `.retired`) that carry a manifest.json. Missing workshop dir → empty list.
 */
export function listTools(overlayDir: string): WorkshopToolInfo[] {
  const root = workshopDir(overlayDir);
  if (!fs.existsSync(root)) return [];
  const tools: WorkshopToolInfo[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === RETIRED_DIR) continue;
    const dir = path.join(root, entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
    tools.push({ name: entry.name, dir, manifest });
  }
  return tools.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Options for {@link retire}. */
export interface RetireOptions {
  readonly overlayDir: string;
  /** Short tool name (directory under workshop/). */
  readonly name: string;
  /** Who ratified the removal — mandatory; removal is always human-ratified. */
  readonly ratifiedBy: string;
  /** Injectable clock (epoch ms); defaults to Date.now. */
  readonly clock?: () => number;
}

/** Result of {@link retire}: where the tool's history now lives. */
export interface RetireResult {
  readonly name: string;
  /** Absolute path under workshop/.retired/ holding the tool's files. */
  readonly retiredDir: string;
  readonly ratifiedBy: string;
}

/**
 * Retire a live workshop tool (spec §3.2: removal is always human-ratified;
 * spec §5.6 cap: at 12 live tools, forging requires retiring). The tool
 * moves to `workshop/.retired/<name>-<timestamp>/` — history is preserved,
 * never deleted — and its lifecycle records the retirement.
 */
export function retire(options: RetireOptions): RetireResult {
  const { overlayDir, name } = options;
  if (typeof options.ratifiedBy !== 'string' || options.ratifiedBy.trim() === '') {
    throw new RatificationRequiredError('retire');
  }
  const dir = toolDir(overlayDir, name);
  if (!fs.existsSync(dir)) {
    throw new UnknownToolError(name);
  }
  const at = (options.clock ?? Date.now)();
  const retiredRoot = path.join(workshopDir(overlayDir), RETIRED_DIR);
  fs.mkdirSync(retiredRoot, { recursive: true });
  const retiredDir = path.join(retiredRoot, `${name}-${at}`);
  fs.renameSync(dir, retiredDir);
  recordRetirement({ overlayDir, name, ratifiedBy: options.ratifiedBy, at });
  return { name, retiredDir, ratifiedBy: options.ratifiedBy };
}
