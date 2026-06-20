/**
 * The five model-CLI adapter definitions as data (spec §3.1 Adapters):
 * claude, codex, gemini, opencode, and ollama (experimental per spec §5.8).
 *
 * A definition records the command name, how to shape argv/stdin for one
 * prompt, and how to read response text + token/cost usage back out of the
 * CLI's recorded output format. Definitions make NO routing decisions and
 * do NO prompt assembly (spec §3.1 "Explicitly NOT"): the prompt and the
 * optional model pass through verbatim, chosen entirely by the caller.
 *
 * Output formats are ported by evidence from nexus-agents v1
 * `cli-adapters/parsers/*` (see PORT-NOTES.md). Parsing is defensive:
 * malformed output yields `null`, never a guess — and usage that the CLI
 * does not report is `null`, never fabricated (honesty over completeness).
 *
 * Each definition ALSO carries a declarative MODEL-ROUTING profile (spec §8.4):
 * how this harness binds a {@link ModelTier} to a concrete model/alias, whether
 * it exposes an effort/reasoning param, and which model capabilities it
 * advertises. These are pure data — the kernel imports only the
 * ModelTier/Effort/ModelCapability TYPES from contracts (no runtime model
 * code), and the PURE resolution over them lives in `./translate.ts`
 * (CLM-0061: kernel originates no model call).
 *
 * @module kernel/adapters/definitions
 */
import type { Effort, ModelCapability, ModelTier } from '@kernloop/contracts';
import {
  parseClaudeOutput,
  parseCodexOutput,
  parseGeminiOutput,
  parseOllamaOutput,
  parseOpencodeOutput,
} from './parsers.js';

/** The five adapter names — the complete spec §3.1 set. */
export const ADAPTER_NAMES = ['claude', 'codex', 'gemini', 'opencode', 'ollama'] as const;

/** One of the five adapter names. */
export type AdapterName = (typeof ADAPTER_NAMES)[number];

/** Token/cost usage as reported BY THE CLI ITSELF — never estimated here. */
export interface AdapterUsage {
  /** Input tokens the CLI reported. */
  readonly inputTokens: number;
  /** Output tokens the CLI reported. */
  readonly outputTokens: number;
  /** Dollars the CLI reported, or null when the CLI does not report cost. */
  readonly usd: number | null;
}

/** What a definition's parser recovered from raw stdout. */
export interface ParsedOutput {
  /** Response text, or null when no usable response is present. */
  readonly output: string | null;
  /** CLI-reported usage, or null when the output carries none. */
  readonly usage: AdapterUsage | null;
}

/** argv/stdin shape for one invocation. */
export interface AdapterCommand {
  /** Arguments passed verbatim to the executable. */
  readonly args: readonly string[];
  /** Prompt content delivered via stdin (when the CLI reads stdin). */
  readonly stdin?: string;
}

/** A resolved effort knob ready to ride into argv (already translated). */
export interface AdapterCommandEffort {
  /** The CLI flag / body key (from the adapter's effort profile). */
  readonly param: string;
  /** The literal the CLI expects, already resolved by the translation seam. */
  readonly value: string;
  /** Where the value rides — only `arg` is delivered in this phase. */
  readonly via: 'arg' | 'body';
}

/** Inputs a definition may shape into argv — nothing else exists here. */
export interface AdapterCommandRequest {
  /** The fully assembled prompt, passed through verbatim. */
  readonly prompt: string;
  /** Model identifier chosen by the caller; passed through verbatim. */
  readonly model?: string;
  /**
   * Resolved effort knob, when the caller asked for one AND the adapter
   * supports it (the translation seam decides). Omitted ⇒ no effort arg is
   * added (dropped honestly). `via:'body'` is reserved for a future
   * direct-API adapter and adds nothing to argv here.
   */
  readonly effort?: AdapterCommandEffort;
  /**
   * Invoke the CLI as a PURE COMPLETION (#148): disable filesystem/edit tools so
   * a REASONING node (research/plan/decompose/vote/review) only sees the prompt +
   * returns text, never reading or writing the workspace. Coverage is per-CLI and
   * HONEST: claude denies its tools (`--disallowedTools`); gemini runs read-only
   * (`--approval-mode plan`); codex is ALREADY `-s read-only` (writes blocked,
   * reads still allowed — partial); opencode has no run-level flag (no coverage —
   * recorded, not faked). The coder node leaves this unset (it needs tools).
   */
  readonly pureCompletion?: boolean;
}

/** The `[param, value]` argv pair for an arg-delivered effort knob, else nothing. */
function effortArgs(effort: AdapterCommandEffort | undefined): string[] {
  return effort !== undefined && effort.via === 'arg' ? [effort.param, effort.value] : [];
}

/**
 * claude's fs/exec/network tool names denied in pure-completion mode (#148) — the
 * known surface a reasoning node must not touch. A space-separated `--disallowedTools`
 * value (the CLI accepts comma/space-separated names).
 */
export const CLAUDE_PURE_COMPLETION_DENY =
  'Bash Read Write Edit MultiEdit NotebookEdit Glob Grep WebFetch WebSearch Task';

/** Pure-completion restriction argv for a CLI (#148); `[]` when off or unsupported. */
function pureCompletionArgs(adapter: AdapterName, pure: boolean | undefined): string[] {
  if (pure !== true) return [];
  if (adapter === 'claude') return ['--disallowedTools', CLAUDE_PURE_COMPLETION_DENY];
  if (adapter === 'gemini') return ['--approval-mode', 'plan'];
  return []; // codex already -s read-only; opencode/ollama have no run-level flag
}

/**
 * How completely an adapter can run a reasoning node TOOL-FREE (#148, #355) — the
 * SINGLE declarative source the dispatch layer reads so a degraded posture is
 * audited, never silent (CLM-0155 records the coverage per CLI):
 *  - `full` — every fs/exec/network tool is denied: claude `--disallowedTools`
 *    over the known surface.
 *  - `partial` — a real but incomplete restriction: gemini `--approval-mode plan`
 *    (plans, does not execute) and codex `exec -s read-only` (writes/exec blocked,
 *    but the model can still READ the workspace).
 *  - `none` — NO run-level restriction is applied: opencode/ollama have no flag,
 *    so a `pureCompletion` request is best-effort, not enforced.
 * Kept in lockstep with {@link pureCompletionArgs}; a new tool-disable flag moves
 * an adapter up a tier here in the same change.
 */
export type PureCompletionCoverage = 'full' | 'partial' | 'none';

/** The {@link PureCompletionCoverage} for an adapter (#355) — see its docs. */
export function pureCompletionCoverage(adapter: AdapterName): PureCompletionCoverage {
  if (adapter === 'claude') return 'full';
  if (adapter === 'gemini' || adapter === 'codex') return 'partial';
  return 'none'; // opencode, ollama — no run-level tool-disable flag
}

/**
 * How an adapter presents models (spec §8.4, declarative):
 *  - `harness-routed` — the model is a stable ALIAS the harness resolves
 *    (claude `opus`/`sonnet`, gemini family ids); `''` means let the harness
 *    pick its own default.
 *  - `concrete-id` — the model is a concrete id the CLI takes verbatim.
 *  - `api` — a future direct-API adapter (no such adapter ships in this phase).
 */
export type AdapterKind = 'harness-routed' | 'concrete-id' | 'api';

/**
 * How an adapter exposes an effort/reasoning knob (declarative). `levels` maps
 * each supported {@link Effort} to the literal the CLI expects; an omitted
 * effort profile means the adapter has NO effort param and the setting is
 * dropped honestly (never faked). `via` says whether the value rides as a CLI
 * arg or (future) a request-body field.
 */
export interface AdapterEffortProfile {
  /** The CLI flag / body key the effort value rides on. */
  readonly param: string;
  /** Where the value is placed for this adapter. */
  readonly via: 'arg' | 'body';
  /** Supported effort levels → the literal the CLI expects for each. */
  readonly levels: Partial<Record<Effort, string>>;
}

/** One model-CLI adapter, declared as data. */
export interface AdapterDefinition {
  /** Adapter name (equals the registry key). */
  readonly name: AdapterName;
  /** Executable looked up on PATH. */
  readonly command: string;
  /** True for adapters shipped at the `experimental` tier (spec §5.8). */
  readonly experimental: boolean;
  /** True when the CLI cannot run without an explicit model (ollama). */
  readonly requiresModel: boolean;
  /** Shape argv/stdin for one prompt. */
  readonly buildCommand: (request: AdapterCommandRequest) => AdapterCommand;
  /** Read response text + usage out of captured stdout. */
  readonly parseOutput: (stdout: string) => ParsedOutput;
  /** How this harness presents models (spec §8.4). */
  readonly kind: AdapterKind;
  /** True when the harness has its own auto-router (a model can be left ''). */
  readonly hasAutoRouter: boolean;
  /**
   * Tier → model/alias for THIS harness (spec §8.4). A harness-routed adapter
   * maps to a stable alias (`opus`) or `''` (let the harness default); a
   * concrete-id adapter maps to a concrete model id. Partial: an unpopulated
   * tier is what the translation seam degrades DOWNWARD past — the volatile
   * concrete-model bindings belong in the overlay/catalog (a later phase).
   */
  readonly tierBinding: Partial<Record<ModelTier, string>>;
  /** Effort knob, or omitted when the adapter has none (effort dropped). */
  readonly effort?: AdapterEffortProfile;
  /** Model capabilities this adapter advertises (spec §8.4). */
  readonly capabilities: readonly ModelCapability[];
}

/** Append `[flag, model]` when the caller picked a model. */
function modelArgs(flag: string, model: string | undefined): string[] {
  return model === undefined ? [] : [flag, model];
}

/**
 * The five adapter definitions, keyed by name. Argv shapes are the ones v1
 * verified against the real CLIs (see PORT-NOTES.md for per-CLI evidence).
 */
export const adapterDefinitions: Readonly<Record<AdapterName, AdapterDefinition>> = {
  claude: {
    name: 'claude',
    command: 'claude',
    experimental: false,
    requiresModel: false,
    // Prompt via stdin to avoid argv escaping issues (v1 evidence).
    buildCommand: ({ prompt, model, effort, pureCompletion }) => ({
      args: [
        '-p',
        '--output-format',
        'json',
        ...modelArgs('--model', model),
        ...effortArgs(effort),
        ...pureCompletionArgs('claude', pureCompletion),
      ],
      stdin: prompt,
    }),
    parseOutput: parseClaudeOutput,
    // Harness-routed: stable aliases the claude CLI resolves to live models.
    // These aliases are stable; the volatile concrete bindings (and any
    // overrides) belong in the overlay/catalog (a later phase).
    kind: 'harness-routed',
    hasAutoRouter: true,
    tierBinding: { frontier: 'fable', large: 'opus', medium: 'sonnet', small: 'haiku' },
    effort: {
      param: '--effort',
      via: 'arg',
      levels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'max' },
    },
    capabilities: ['toolUse', 'vision', 'longContext', 'jsonMode'],
  },
  codex: {
    name: 'codex',
    command: 'codex',
    experimental: false,
    requiresModel: false,
    // Read-only sandbox + skip-git-repo-check ported from v1 as safe
    // non-interactive defaults; prompt is positional (v1 evidence).
    buildCommand: ({ prompt, model, effort }) => ({
      args: [
        'exec',
        '--json',
        '-s',
        'read-only',
        '--skip-git-repo-check',
        ...modelArgs('-m', model),
        ...effortArgs(effort),
        prompt,
      ],
    }),
    parseOutput: parseCodexOutput,
    // Concrete-id: the CLI takes a concrete model id; no stable tier alias
    // ships here (the catalog binds concrete ids in a later phase).
    kind: 'concrete-id',
    hasAutoRouter: false,
    tierBinding: {},
    effort: {
      param: 'model_reasoning_effort',
      via: 'arg',
      levels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    },
    capabilities: ['toolUse', 'jsonMode'],
  },
  gemini: {
    name: 'gemini',
    command: 'gemini',
    experimental: false,
    requiresModel: false,
    // Prompt is positional, JSON output via -o (v1 evidence).
    buildCommand: ({ prompt, model, pureCompletion }) => ({
      args: [
        prompt,
        '-o',
        'json',
        ...modelArgs('-m', model),
        ...pureCompletionArgs('gemini', pureCompletion),
      ],
    }),
    parseOutput: parseGeminiOutput,
    // Harness-routed: gemini model family ids per tier; no effort param.
    kind: 'harness-routed',
    hasAutoRouter: false,
    tierBinding: {
      frontier: 'gemini-3.1-pro',
      large: 'gemini-3.1-pro',
      medium: 'gemini-3-flash',
      small: 'gemini-3.1-flash-lite',
    },
    capabilities: ['toolUse', 'vision', 'longContext', 'jsonMode'],
  },
  opencode: {
    name: 'opencode',
    command: 'opencode',
    experimental: false,
    requiresModel: false,
    // Prompt via stdin (v1 evidence).
    buildCommand: ({ prompt, model }) => ({
      args: ['run', '--format', 'json', ...modelArgs('-m', model)],
      stdin: prompt,
    }),
    parseOutput: parseOpencodeOutput,
    // Passthrough harness: every tier defaults ('') unless an overlay binds a
    // concrete model. Its own auto-router picks when none is named.
    kind: 'harness-routed',
    hasAutoRouter: true,
    tierBinding: { frontier: '', large: '', medium: '', small: '' },
    capabilities: ['toolUse', 'jsonMode'],
  },
  ollama: {
    name: 'ollama',
    command: 'ollama',
    // Experimental until claimed (spec §5.8) — reported honestly, not hidden.
    experimental: true,
    // `ollama run` has no default model; the caller must name one.
    requiresModel: true,
    buildCommand: ({ prompt, model }) => ({
      args: ['run', ...(model === undefined ? [] : [model])],
      stdin: prompt,
    }),
    parseOutput: parseOllamaOutput,
    // Concrete-id local models; NO effort param (effort is dropped honestly).
    // No stable tier alias ships (local model names are overlay/catalog data).
    kind: 'concrete-id',
    hasAutoRouter: false,
    tierBinding: {},
    capabilities: ['toolUse'],
  },
};
