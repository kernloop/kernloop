/**
 * The five model-CLI adapter definitions as data (spec §3.1 Adapters):
 * claude, codex, gemini, opencode, and ollama (experimental per spec §5.7).
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
 * @module kernel/adapters/definitions
 */

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

/** Inputs a definition may shape into argv — nothing else exists here. */
export interface AdapterCommandRequest {
  /** The fully assembled prompt, passed through verbatim. */
  readonly prompt: string;
  /** Model identifier chosen by the caller; passed through verbatim. */
  readonly model?: string;
}

/** One model-CLI adapter, declared as data. */
export interface AdapterDefinition {
  /** Adapter name (equals the registry key). */
  readonly name: AdapterName;
  /** Executable looked up on PATH. */
  readonly command: string;
  /** True for adapters shipped at the `experimental` tier (spec §5.7). */
  readonly experimental: boolean;
  /** True when the CLI cannot run without an explicit model (ollama). */
  readonly requiresModel: boolean;
  /** Shape argv/stdin for one prompt. */
  readonly buildCommand: (request: AdapterCommandRequest) => AdapterCommand;
  /** Read response text + usage out of captured stdout. */
  readonly parseOutput: (stdout: string) => ParsedOutput;
}

/** Narrow an unknown to a plain object record, else null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a non-negative integer field (token counts), else null. */
function intField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Read a non-negative finite number field (dollar amounts), else null. */
function numField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** JSON.parse that returns null instead of throwing. */
function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Split NDJSON into parsed records, silently skipping malformed lines. */
function ndjsonRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const record = asRecord(tryJson(line));
    if (record !== null) records.push(record);
  }
  return records;
}

/** Read `{input_tokens, output_tokens}`-shaped usage (claude, codex). */
function usageFromSnakeTokens(
  record: Record<string, unknown>,
  usd: number | null,
): AdapterUsage | null {
  const inputTokens = intField(record, 'input_tokens');
  const outputTokens = intField(record, 'output_tokens');
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens, usd };
}

/**
 * claude CLI single-JSON output (v1 `claude-parser.ts`, claude 2.0.x):
 * `{"type":"result","is_error":false,"result":"…","usage":{"input_tokens":…,
 * "output_tokens":…},"total_cost_usd":0.0015}`. The only CLI of the five
 * that reports dollars directly.
 */
function parseClaudeOutput(stdout: string): ParsedOutput {
  const record = asRecord(tryJson(stdout));
  if (record === null) return { output: null, usage: null };
  const usageRecord = asRecord(record.usage);
  const usage =
    usageRecord === null
      ? null
      : usageFromSnakeTokens(usageRecord, numField(record, 'total_cost_usd'));
  if (record.is_error === true) return { output: null, usage };
  const result = record.result;
  return { output: typeof result === 'string' ? result : null, usage };
}

/**
 * codex CLI NDJSON output (v1 `codex-parser.ts`, codex 0.7x `exec --json`):
 * `item.completed` events with `item.type === "agent_message"` carry the
 * response; the `turn.completed` event carries `usage.{input,output}_tokens`.
 * No dollar figure is reported.
 */
function parseCodexOutput(stdout: string): ParsedOutput {
  const messages: string[] = [];
  let usage: AdapterUsage | null = null;
  for (const record of ndjsonRecords(stdout)) {
    if (record.type === 'item.completed') {
      const item = asRecord(record.item);
      if (item !== null && item.type === 'agent_message' && typeof item.text === 'string') {
        messages.push(item.text);
      }
    } else if (record.type === 'turn.completed') {
      const usageRecord = asRecord(record.usage);
      if (usageRecord !== null) usage = usageFromSnakeTokens(usageRecord, null) ?? usage;
    }
  }
  return { output: messages.length > 0 ? messages.join('\n') : null, usage };
}

/** Sum gemini per-model `tokens.{input,candidates}` stats into one usage. */
function aggregateGeminiUsage(models: Record<string, unknown>): AdapterUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let sawAny = false;
  for (const modelStats of Object.values(models)) {
    const tokens = asRecord(asRecord(modelStats)?.tokens ?? null);
    if (tokens === null) continue;
    const input = intField(tokens, 'input');
    const candidates = intField(tokens, 'candidates');
    if (input !== null) {
      inputTokens += input;
      sawAny = true;
    }
    if (candidates !== null) {
      outputTokens += candidates;
      sawAny = true;
    }
  }
  return sawAny ? { inputTokens, outputTokens, usd: null } : null;
}

/**
 * gemini CLI single-JSON output (v1 `gemini-parser.ts`, gemini 0.2x
 * `-o json`): `{"response":"…","stats":{"models":{"<model>":{"tokens":
 * {"input":…,"candidates":…}}}}}`. Per-model stats are aggregated; no
 * dollar figure is reported.
 */
function parseGeminiOutput(stdout: string): ParsedOutput {
  const record = asRecord(tryJson(stdout));
  if (record === null) return { output: null, usage: null };
  const models = asRecord(asRecord(record.stats)?.models ?? null);
  const usage = models === null ? null : aggregateGeminiUsage(models);
  const response = record.response;
  return { output: typeof response === 'string' ? response : null, usage };
}

/** Read opencode `step_finish` part: `tokens.{input,output}` + `cost`. */
function usageFromOpencodePart(part: Record<string, unknown>): AdapterUsage | null {
  const tokens = asRecord(part.tokens);
  if (tokens === null) return null;
  const inputTokens = intField(tokens, 'input');
  const outputTokens = intField(tokens, 'output');
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens, usd: numField(part, 'cost') };
}

/**
 * opencode CLI NDJSON output (v1 `opencode-parser.ts`, opencode 1.2.x
 * `run --format json`): `text` events carry `part.text` fragments;
 * `step_finish` carries `part.tokens.{input,output}` and `part.cost` (usd).
 * `error` events void the response — a stream that errored is not a result.
 */
function parseOpencodeOutput(stdout: string): ParsedOutput {
  const fragments: string[] = [];
  let usage: AdapterUsage | null = null;
  let errored = false;
  for (const record of ndjsonRecords(stdout)) {
    const part = asRecord(record.part);
    if (record.type === 'text' && part !== null && typeof part.text === 'string') {
      fragments.push(part.text);
    } else if (record.type === 'step_finish' && part !== null) {
      usage = usageFromOpencodePart(part) ?? usage;
    } else if (record.type === 'error') {
      errored = true;
    }
  }
  const output = !errored && fragments.length > 0 ? fragments.join('') : null;
  return { output, usage };
}

/**
 * ollama CLI plain-text output (`ollama run <model>`): the response is raw
 * stdout, and NO usage is reported in non-interactive output — so usage is
 * always null here and the call is metered `false` upstream, never guessed.
 */
function parseOllamaOutput(stdout: string): ParsedOutput {
  const text = stdout.trim();
  return { output: text === '' ? null : text, usage: null };
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
    buildCommand: ({ prompt, model }) => ({
      args: ['-p', '--output-format', 'json', ...modelArgs('--model', model)],
      stdin: prompt,
    }),
    parseOutput: parseClaudeOutput,
  },
  codex: {
    name: 'codex',
    command: 'codex',
    experimental: false,
    requiresModel: false,
    // Read-only sandbox + skip-git-repo-check ported from v1 as safe
    // non-interactive defaults; prompt is positional (v1 evidence).
    buildCommand: ({ prompt, model }) => ({
      args: [
        'exec',
        '--json',
        '-s',
        'read-only',
        '--skip-git-repo-check',
        ...modelArgs('-m', model),
        prompt,
      ],
    }),
    parseOutput: parseCodexOutput,
  },
  gemini: {
    name: 'gemini',
    command: 'gemini',
    experimental: false,
    requiresModel: false,
    // Prompt is positional, JSON output via -o (v1 evidence).
    buildCommand: ({ prompt, model }) => ({
      args: [prompt, '-o', 'json', ...modelArgs('-m', model)],
    }),
    parseOutput: parseGeminiOutput,
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
  },
  ollama: {
    name: 'ollama',
    command: 'ollama',
    // Experimental until claimed (spec §5.7) — reported honestly, not hidden.
    experimental: true,
    // `ollama run` has no default model; the caller must name one.
    requiresModel: true,
    buildCommand: ({ prompt, model }) => ({
      args: ['run', ...(model === undefined ? [] : [model])],
      stdin: prompt,
    }),
    parseOutput: parseOllamaOutput,
  },
};
