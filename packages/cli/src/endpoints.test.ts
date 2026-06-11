/**
 * The overlay `endpoints` config boundary [CLM-0083]: an endpoint is registered
 * by id with an env-var NAME for its key — and a LITERAL key is rejected at
 * parse, so a secret can never be committed to overlay.yaml. `apiDefinitionFor`
 * builds a kernel ApiAdapterDefinition that carries the env-var name (never a
 * key) and the tier→model map.
 */
import { describe, expect, it } from 'vitest';
import { EndpointSchema, apiDefinitionFor, looksLikeSecret } from './endpoints.js';

const valid = {
  baseUrl: 'https://api.example.com/v1',
  apiKeyEnv: 'MY_PROVIDER_API_KEY',
  models: { frontier: 'big-model', medium: 'small-model' },
};

describe('EndpointSchema — env-var name, never a literal key', () => {
  it('accepts an UPPER_SNAKE env-var name', () => {
    expect(EndpointSchema.parse(valid).apiKeyEnv).toBe('MY_PROVIDER_API_KEY');
  });

  it('REJECTS an apiKeyEnv that is a literal key (sk- prefix)', () => {
    const r = EndpointSchema.safeParse({ ...valid, apiKeyEnv: 'sk-or-abcdef0123456789' });
    expect(r.success).toBe(false);
  });

  it('REJECTS an apiKeyEnv that is a long high-entropy token', () => {
    const r = EndpointSchema.safeParse({ ...valid, apiKeyEnv: 'aB3xYz9012345678PqRsTuVw' });
    expect(r.success).toBe(false);
  });

  it('REJECTS a lowercase / non-env-name apiKeyEnv', () => {
    expect(EndpointSchema.safeParse({ ...valid, apiKeyEnv: 'my-key' }).success).toBe(false);
  });

  it('REJECTS a header value that looks like a literal secret', () => {
    const r = EndpointSchema.safeParse({
      ...valid,
      headers: { authorization: 'Bearer sk-or-abcdef0123456789' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts benign static headers', () => {
    const r = EndpointSchema.safeParse({ ...valid, headers: { 'HTTP-Referer': 'kernloop.dev' } });
    expect(r.success).toBe(true);
  });
});

describe('looksLikeSecret', () => {
  it('flags provider key prefixes and long tokens', () => {
    expect(looksLikeSecret('sk-abc')).toBe(true);
    expect(looksLikeSecret('sk-or-v1-deadbeef')).toBe(true);
    expect(looksLikeSecret('aB3xYz9012345678PqRsTuVw')).toBe(true);
  });

  it('does not flag plain config strings', () => {
    expect(looksLikeSecret('MY_PROVIDER_API_KEY')).toBe(false);
    expect(looksLikeSecret('kernloop.dev')).toBe(false);
    expect(looksLikeSecret('gpt-4o')).toBe(false);
  });
});

describe('apiDefinitionFor — builds a key-free kernel definition', () => {
  it('carries the env-var NAME (never a key) + the tier→model map + body effort', () => {
    const def = apiDefinitionFor('my-provider', EndpointSchema.parse(valid));
    expect(def.kind).toBe('api');
    expect(def.name).toBe('my-provider');
    expect(def.apiKeyEnv).toBe('MY_PROVIDER_API_KEY');
    expect(def.tierBinding).toEqual({ frontier: 'big-model', medium: 'small-model' });
    expect(def.effort?.via).toBe('body');
    expect(def.effort?.param).toBe('reasoning_effort');
    // The definition object contains no key — only the env-var name.
    expect(JSON.stringify(def)).not.toContain('sk-');
  });

  it('passes through metersUsd and the optional spend cap', () => {
    const def = apiDefinitionFor(
      'p',
      EndpointSchema.parse({ ...valid, metersUsd: true, maxUsdPerCall: 0.25 }),
    );
    expect(def.metersUsd).toBe(true);
    expect(def.maxUsdPerCall).toBe(0.25);
  });
});
