/**
 * Kernel translation seam acceptance tests (CLM-0079): the PURE resolution of
 * a ModelRequirement's tier/effort against an adapter's declarative profile.
 *
 * Pins the honesty contract: tier resolution degrades DOWNWARD ONLY and records
 * `degraded`; effort clamps to the nearest supported level (recording
 * `clamped`) or is DROPPED honestly (`servedEffort: 'unsupported'`) when the
 * adapter has no effort param. No heuristic, no upward step, no fabricated
 * model — a static lookup the kernel performs without a model call (CLM-0061).
 */
import { describe, expect, it } from 'vitest';
import { adapterDefinitions } from './definitions.js';
import { resolveEffort, resolveTierModel } from './translate.js';

describe('resolveTierModel — exact hit + downward-only degradation', () => {
  const claude = adapterDefinitions.claude.tierBinding;

  it('returns the exact bound model for a populated tier, not degraded', () => {
    expect(resolveTierModel('frontier', claude)).toEqual({
      model: 'fable',
      servedTier: 'frontier',
      degraded: false,
    });
    expect(resolveTierModel('small', claude)).toEqual({
      model: 'haiku',
      servedTier: 'small',
      degraded: false,
    });
  });

  it('steps DOWNWARD to the nearest populated tier and records degraded', () => {
    // A binding missing `large` would degrade frontier→large→… ; construct one.
    const sparse = { frontier: 'top', small: 'tiny' } as const;
    expect(resolveTierModel('large', sparse)).toEqual({
      model: 'tiny',
      servedTier: 'small',
      degraded: true,
    });
    expect(resolveTierModel('medium', sparse)).toEqual({
      model: 'tiny',
      servedTier: 'small',
      degraded: true,
    });
    // Sanity: claude's binding has every tier populated → never degrades.
    expect(resolveTierModel('medium', adapterDefinitions.claude.tierBinding).degraded).toBe(false);
  });

  it('NEVER steps upward: a request below the only populated tier defaults the harness', () => {
    const onlyFrontier = { frontier: 'top' } as const;
    expect(resolveTierModel('small', onlyFrontier)).toEqual({
      model: '',
      servedTier: 'small',
      degraded: false,
    });
  });

  it('an empty binding always defaults the harness (no fabricated id)', () => {
    expect(resolveTierModel('frontier', {})).toEqual({
      model: '',
      servedTier: 'frontier',
      degraded: false,
    });
  });
});

describe('resolveEffort — exact, clamp, and honest drop', () => {
  const claudeEffort = adapterDefinitions.claude.effort;

  it('maps a supported effort to the adapter literal, not clamped', () => {
    expect(resolveEffort('high', claudeEffort)).toEqual({
      value: 'high',
      servedEffort: 'high',
      clamped: false,
    });
    // claude maps xhigh → its own 'max' literal.
    expect(resolveEffort('xhigh', claudeEffort)).toEqual({
      value: 'max',
      servedEffort: 'xhigh',
      clamped: false,
    });
  });

  it('clamps an unsupported level to the nearest supported AT-OR-BELOW, recording clamped', () => {
    // A profile that supports only low + high: xhigh clamps DOWN to high.
    const profile = { param: '-e', via: 'arg', levels: { low: 'lo', high: 'hi' } } as const;
    expect(resolveEffort('xhigh', profile)).toEqual({
      value: 'hi',
      servedEffort: 'high',
      clamped: true,
    });
    // medium (between low and high) clamps DOWN to low.
    expect(resolveEffort('medium', profile)).toEqual({
      value: 'lo',
      servedEffort: 'low',
      clamped: true,
    });
  });

  it('clamps UP to the highest supported only when none is at-or-below', () => {
    // Supports only high+xhigh: a low request has nothing at-or-below → highest.
    const profile = { param: '-e', via: 'arg', levels: { high: 'hi', xhigh: 'mx' } } as const;
    expect(resolveEffort('low', profile)).toEqual({
      value: 'mx',
      servedEffort: 'xhigh',
      clamped: true,
    });
  });

  it('DROPS effort honestly for an adapter with no effort param (ollama)', () => {
    expect(adapterDefinitions.ollama.effort).toBeUndefined();
    expect(resolveEffort('high', adapterDefinitions.ollama.effort)).toEqual({
      value: undefined,
      servedEffort: 'unsupported',
      clamped: false,
    });
  });

  it('treats an empty levels map as no support rather than fabricating a level', () => {
    const empty = { param: '-e', via: 'arg', levels: {} } as const;
    expect(resolveEffort('medium', empty)).toEqual({
      value: undefined,
      servedEffort: 'unsupported',
      clamped: false,
    });
  });
});

describe('the six adapters declare their model-routing profile (spec §8.4)', () => {
  it('agy (Antigravity, #387) is harness-routed: Gemini tier names, NO effort param', () => {
    const agy = adapterDefinitions.agy;
    expect(agy.kind).toBe('harness-routed');
    expect(agy.hasAutoRouter).toBe(true);
    // Tiers map to the verbatim model names `agy models` lists.
    expect(agy.tierBinding.frontier).toBe('Gemini 3.1 Pro (High)');
    expect(agy.tierBinding.small).toBe('Gemini 3.5 Flash (Low)');
    // Effort is baked into the model name (Low/Med/High/Thinking) → no effort param.
    expect(agy.effort).toBeUndefined();
    expect(resolveEffort('high', agy.effort)).toEqual({
      value: undefined,
      servedEffort: 'unsupported',
      clamped: false,
    });
    // Print mode argv `-p <prompt> --model <m>`; no fs-restriction flag exists, so
    // pureCompletion adds nothing → identical argv (honest `none` coverage, #387).
    expect(agy.buildCommand({ prompt: 'p', model: 'm' }).args).toEqual(['-p', 'p', '--model', 'm']);
    expect(agy.buildCommand({ prompt: 'p', model: 'm', pureCompletion: true }).args).toEqual([
      '-p',
      'p',
      '--model',
      'm',
    ]);
  });

  it('claude is harness-routed with a full tier ladder + effort + capabilities', () => {
    const claude = adapterDefinitions.claude;
    expect(claude.kind).toBe('harness-routed');
    expect(claude.hasAutoRouter).toBe(true);
    expect(claude.tierBinding).toEqual({
      frontier: 'fable',
      large: 'opus',
      medium: 'sonnet',
      small: 'haiku',
    });
    expect(claude.effort?.param).toBe('--effort');
    expect(claude.capabilities).toContain('vision');
  });

  it('codex is concrete-id; reasoning effort rides as a `-c` config override (#378)', () => {
    const codex = adapterDefinitions.codex;
    expect(codex.kind).toBe('concrete-id');
    expect(codex.tierBinding).toEqual({});
    // `codex exec` takes effort as `-c model_reasoning_effort=<level>`, NOT a bare
    // positional — the param is `-c` and the resolved value is the `key=value` pair.
    expect(codex.effort?.param).toBe('-c');
    expect(resolveEffort('high', codex.effort).value).toBe('model_reasoning_effort=high');
    // …so the built argv carries the config override the CLI accepts.
    const args = codex.buildCommand({
      prompt: 'p',
      effort: { param: '-c', value: 'model_reasoning_effort=high', via: 'arg' },
    }).args;
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort=high');
  });

  it('opencode is a passthrough harness: every tier defaults the harness', () => {
    const opencode = adapterDefinitions.opencode;
    expect(opencode.kind).toBe('harness-routed');
    expect(opencode.hasAutoRouter).toBe(true);
    expect(resolveTierModel('frontier', opencode.tierBinding).model).toBe('');
  });

  it('ollama is concrete-id with NO effort param', () => {
    expect(adapterDefinitions.ollama.kind).toBe('concrete-id');
    expect(adapterDefinitions.ollama.requiresModel).toBe(true);
    expect(adapterDefinitions.ollama.effort).toBeUndefined();
  });
});
