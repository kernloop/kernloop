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
    // gemini binds frontier+large to the same id, medium/small to flash variants.
    const gemini = adapterDefinitions.gemini.tierBinding;
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
    // Sanity: the real gemini binding has every tier populated → never degrades.
    expect(resolveTierModel('medium', gemini).degraded).toBe(false);
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

describe('the five adapters declare their model-routing profile (spec §8.4)', () => {
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

  it('codex is concrete-id with a reasoning-effort param and no tier alias', () => {
    const codex = adapterDefinitions.codex;
    expect(codex.kind).toBe('concrete-id');
    expect(codex.tierBinding).toEqual({});
    expect(codex.effort?.param).toBe('model_reasoning_effort');
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
