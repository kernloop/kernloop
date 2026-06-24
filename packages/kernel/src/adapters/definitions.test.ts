/**
 * Adapter definition acceptance tests (CLM-0020, CLM-0021): the five CLI
 * definitions expose one uniform data shape, and each parser reads token /
 * cost usage out of that CLI's recorded output format — or reports null,
 * never a fabricated number.
 *
 * Fixtures are derived from the output formats the v1 quarry verified
 * against the real CLIs (nexus-agents `cli-adapters/parsers/*` tests).
 */

import { describe, expect, it } from 'vitest';
import {
  ADAPTER_NAMES,
  CLAUDE_PURE_COMPLETION_DENY,
  adapterDefinitions,
  pureCompletionCoverage,
} from './definitions.js';

/** Recorded claude 2.0.x `--output-format json` response (v1 evidence). */
const claudeFixture = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1500,
  result: 'Hello, world!',
  session_id: 'sess_123',
  total_cost_usd: 0.0015,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
});

/** Recorded codex 0.7x `exec --json` NDJSON stream (v1 evidence). */
const codexFixture = [
  '{"type":"thread.started","thread_id":"thr_1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking…"}}',
  '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"First part."}}',
  '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"Second part."}}',
  '{"type":"turn.completed","usage":{"input_tokens":200,"cached_input_tokens":10,"output_tokens":100}}',
].join('\n');

/** Recorded opencode 1.2.x `run --format json` NDJSON stream (v1 evidence). */
const opencodeFixture = [
  '{"type":"step_start","sessionID":"ses_35f0a92f","part":{"type":"step-start"}}',
  '{"type":"text","sessionID":"ses_35f0a92f","part":{"type":"text","text":"Hel"}}',
  '{"type":"text","sessionID":"ses_35f0a92f","part":{"type":"text","text":"lo!"}}',
  '{"type":"step_finish","sessionID":"ses_35f0a92f","part":{"type":"step-finish","reason":"stop","cost":0.002,"tokens":{"total":18080,"input":78,"output":23,"reasoning":0,"cache":{"read":17979,"write":0}}}}',
].join('\n');

describe('uniform adapter interface (CLM-0021)', () => {
  it('defines exactly the five spec §3.1 adapters', () => {
    expect([...ADAPTER_NAMES]).toEqual(['claude', 'codex', 'opencode', 'ollama', 'agy']);
    expect(Object.keys(adapterDefinitions).sort()).toEqual([...ADAPTER_NAMES].sort());
  });

  it('gives every definition the same shape: command, flags, builder, parser', () => {
    for (const name of ADAPTER_NAMES) {
      const definition = adapterDefinitions[name];
      expect(definition.name).toBe(name);
      expect(definition.command.length).toBeGreaterThan(0);
      expect(typeof definition.experimental).toBe('boolean');
      expect(typeof definition.requiresModel).toBe('boolean');
      expect(typeof definition.metersUsd).toBe('boolean');
      expect(typeof definition.buildCommand).toBe('function');
      expect(typeof definition.parseOutput).toBe('function');
    }
  });

  it('marks only the experimental-tier adapters (ollama, agy) experimental (spec §5.8)', () => {
    const experimental = new Set(['ollama', 'agy']);
    for (const name of ADAPTER_NAMES) {
      expect(adapterDefinitions[name].experimental).toBe(experimental.has(name));
    }
  });

  it('marks only claude as metering USD — the others report tokens-or-nothing (#462)', () => {
    // A usd BUDGET can only be enforced on a metersUsd adapter; the rest surface a
    // warning instead of silently treating $0 as real spend.
    for (const name of ADAPTER_NAMES) {
      expect(adapterDefinitions[name].metersUsd).toBe(name === 'claude');
    }
  });

  it('marks token-metering honestly: claude/codex/opencode yes, ollama/agy no (#462)', () => {
    // ollama/agy emit plain text (usage: null) — they meter NEITHER usd nor tokens, so a
    // token budget cannot bound them either; the #462 audit must say so, not claim it does.
    const metersTokens = new Set(['claude', 'codex', 'opencode']);
    for (const name of ADAPTER_NAMES) {
      expect(adapterDefinitions[name].metersTokens).toBe(metersTokens.has(name));
    }
  });

  it('passes the prompt through verbatim — no prompt assembly (spec §3.1)', () => {
    const prompt = 'verbatim prompt\nwith newline';
    for (const name of ADAPTER_NAMES) {
      const command = adapterDefinitions[name].buildCommand({ prompt, model: 'm' });
      const delivered = command.stdin ?? command.args.find((a) => a === prompt);
      expect(delivered).toBe(prompt);
    }
  });

  it('passes the model through verbatim only when the caller chose one', () => {
    for (const name of ADAPTER_NAMES) {
      const definition = adapterDefinitions[name];
      const withModel = definition.buildCommand({ prompt: 'p', model: 'chosen-model' });
      expect(withModel.args).toContain('chosen-model');
      const withoutModel = definition.buildCommand({ prompt: 'p' });
      expect(withoutModel.args).not.toContain('chosen-model');
    }
  });

  it('rides a resolved arg-effort into argv, and omits it when absent (spec §8.4)', () => {
    const effort = { param: '--effort', value: 'high', via: 'arg' } as const;
    const withEffort = adapterDefinitions.claude.buildCommand({ prompt: 'p', effort });
    expect(withEffort.args).toContain('--effort');
    expect(withEffort.args).toContain('high');
    const withoutEffort = adapterDefinitions.claude.buildCommand({ prompt: 'p' });
    expect(withoutEffort.args).not.toContain('--effort');
    // codex carries reasoning effort as a `-c` config override (#378), not a bare flag.
    const codex = adapterDefinitions.codex.buildCommand({
      prompt: 'p',
      effort: { param: '-c', value: 'model_reasoning_effort=xhigh', via: 'arg' },
    });
    expect(codex.args).toContain('-c');
    expect(codex.args).toContain('model_reasoning_effort=xhigh');
  });

  it('pure-completion (#148) disables tools per CLI, and is absent by default', () => {
    // claude: denies its fs/exec/network tools via --disallowedTools.
    const claudePure = adapterDefinitions.claude.buildCommand({
      prompt: 'p',
      pureCompletion: true,
    });
    expect(claudePure.args).toContain('--disallowedTools');
    expect(claudePure.args).toContain(CLAUDE_PURE_COMPLETION_DENY);
    expect(adapterDefinitions.claude.buildCommand({ prompt: 'p' }).args).not.toContain(
      '--disallowedTools',
    );
    // The deny-list must name only REAL claude tools — `MultiEdit` was removed
    // (claude 2.1.183 emits "matches no known tool" for it), and the core
    // fs/exec/network tools must stay denied (#355, empirically verified).
    expect(CLAUDE_PURE_COMPLETION_DENY).not.toContain('MultiEdit');
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Task']) {
      expect(CLAUDE_PURE_COMPLETION_DENY.split(' ')).toContain(tool);
    }
    // codex stays at its already-restrictive -s read-only (no new flag); opencode has none.
    const codexPure = adapterDefinitions.codex.buildCommand({ prompt: 'p', pureCompletion: true });
    expect(codexPure.args).toContain('read-only'); // already there, unchanged
    expect(codexPure.args).not.toContain('--disallowedTools');
    const opencodePure = adapterDefinitions.opencode.buildCommand({
      prompt: 'p',
      pureCompletion: true,
    });
    expect(opencodePure.args).not.toContain('--approval-mode'); // honest no-coverage
    // agy buildCommand + pureCompletion-none is asserted in translate.test.ts (its profile block).
  });

  it('pureCompletionCoverage (#355) classifies each adapter, in lockstep with the argv', () => {
    // The single declarative source the dispatch layer audits a degraded posture from.
    expect(pureCompletionCoverage('claude')).toBe('full'); // full --disallowedTools surface
    expect(pureCompletionCoverage('codex')).toBe('partial'); // read-only: reads still allowed
    expect(pureCompletionCoverage('opencode')).toBe('none'); // no run-level flag
    expect(pureCompletionCoverage('ollama')).toBe('none'); // no run-level flag
    expect(pureCompletionCoverage('agy')).toBe('none'); // --sandbox blocks exec/net, not fs (#387)
    // Lockstep guard: only the `full` adapter applies an explicit tool-deny flag;
    // a `none` adapter applies no pure-completion argv (best-effort, audited).
    expect(
      adapterDefinitions.claude.buildCommand({ prompt: 'p', pureCompletion: true }).args,
    ).toContain('--disallowedTools');
    expect(
      adapterDefinitions.opencode.buildCommand({ prompt: 'p', pureCompletion: true }).args,
    ).not.toContain('--disallowedTools');
  });
});

describe('claude definition', () => {
  const definition = adapterDefinitions.claude;

  it('shapes argv for non-interactive JSON output with stdin prompt', () => {
    const command = definition.buildCommand({ prompt: 'hi', model: 'claude-sonnet-4-5' });
    expect(command.args).toEqual(['-p', '--output-format', 'json', '--model', 'claude-sonnet-4-5']);
    expect(command.stdin).toBe('hi');
  });

  it('parses response text, tokens, and usd from recorded output (CLM-0020)', () => {
    const parsed = definition.parseOutput(claudeFixture);
    expect(parsed.output).toBe('Hello, world!');
    expect(parsed.usage).toEqual({ inputTokens: 100, outputTokens: 50, usd: 0.0015 });
  });

  it('returns null output when the CLI flags is_error', () => {
    const parsed = definition.parseOutput(
      JSON.stringify({ type: 'result', is_error: true, result: 'API error occurred' }),
    );
    expect(parsed.output).toBeNull();
  });

  it('returns null usage when usage is absent — never fabricated', () => {
    const parsed = definition.parseOutput(JSON.stringify({ is_error: false, result: 'ok' }));
    expect(parsed.output).toBe('ok');
    expect(parsed.usage).toBeNull();
  });

  it('returns nulls for non-JSON output', () => {
    expect(definition.parseOutput('not json at all')).toEqual({ output: null, usage: null });
  });
});

describe('codex definition', () => {
  const definition = adapterDefinitions.codex;

  it('shapes argv for exec --json with a positional prompt', () => {
    const command = definition.buildCommand({ prompt: 'do it', model: 'gpt-5.2-codex' });
    expect(command.args).toEqual([
      'exec',
      '--json',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '-m',
      'gpt-5.2-codex',
      'do it',
    ]);
    expect(command.stdin).toBeUndefined();
  });

  it('joins agent_message items and reads turn.completed usage (CLM-0020)', () => {
    const parsed = definition.parseOutput(codexFixture);
    expect(parsed.output).toBe('First part.\nSecond part.');
    expect(parsed.usage).toEqual({ inputTokens: 200, outputTokens: 100, usd: null });
  });

  it('skips malformed NDJSON lines without losing valid ones', () => {
    const parsed = definition.parseOutput(
      '{{{broken\n{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"ok"}}',
    );
    expect(parsed.output).toBe('ok');
    expect(parsed.usage).toBeNull();
  });

  it('returns null output when no agent_message ever arrives', () => {
    const parsed = definition.parseOutput('{"type":"turn.started"}');
    expect(parsed).toEqual({ output: null, usage: null });
  });
});

describe('opencode definition', () => {
  const definition = adapterDefinitions.opencode;

  it('shapes argv for run --format json with stdin prompt', () => {
    const command = definition.buildCommand({ prompt: 'go', model: 'anthropic/claude-sonnet-4-5' });
    expect(command.args).toEqual(['run', '--format', 'json', '-m', 'anthropic/claude-sonnet-4-5']);
    expect(command.stdin).toBe('go');
  });

  it('concatenates text parts and reads step_finish tokens + cost (CLM-0020)', () => {
    const parsed = definition.parseOutput(opencodeFixture);
    expect(parsed.output).toBe('Hello!');
    expect(parsed.usage).toEqual({ inputTokens: 78, outputTokens: 23, usd: 0.002 });
  });

  it('voids the response when an error event appears in the stream', () => {
    const parsed = definition.parseOutput(
      '{"type":"text","part":{"type":"text","text":"partial"}}\n' +
        '{"type":"error","error":{"message":"boom"}}',
    );
    expect(parsed.output).toBeNull();
  });

  it('returns null usage when step_finish carries no tokens', () => {
    const parsed = definition.parseOutput(
      '{"type":"text","part":{"type":"text","text":"hi"}}\n' +
        '{"type":"step_finish","part":{"type":"step-finish"}}',
    );
    expect(parsed.output).toBe('hi');
    expect(parsed.usage).toBeNull();
  });
});

describe('ollama definition (experimental, spec §5.8)', () => {
  const definition = adapterDefinitions.ollama;

  it('requires an explicit model — no default exists', () => {
    expect(definition.requiresModel).toBe(true);
    const command = definition.buildCommand({ prompt: 'p', model: 'llama3.3' });
    expect(command.args).toEqual(['run', 'llama3.3']);
    expect(command.stdin).toBe('p');
  });

  it('treats stdout as plain text and NEVER reports usage', () => {
    const parsed = definition.parseOutput('A plain text answer.\n');
    expect(parsed.output).toBe('A plain text answer.');
    expect(parsed.usage).toBeNull();
  });

  it('returns null output for empty stdout', () => {
    expect(definition.parseOutput('  \n')).toEqual({ output: null, usage: null });
  });
});
