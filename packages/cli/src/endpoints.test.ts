/**
 * The overlay `endpoints` config boundary [CLM-0083]: an endpoint is registered
 * by id with an env-var NAME for its key — and a LITERAL key is rejected at
 * parse, so a secret can never be committed to overlay.yaml. `apiDefinitionFor`
 * builds a kernel ApiAdapterDefinition that carries the env-var name (never a
 * key) and the tier→model map.
 */
import { describe, expect, it } from 'vitest';
import {
  EndpointSchema,
  apiDefinitionFor,
  looksLikeSecret,
  ownKeyedEndpoints,
} from './endpoints.js';

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
    // A non-reserved header NAME with a secret-shaped VALUE — the value guard
    // (defence-in-depth) catches it, distinct from the reserved-name guard.
    const r = EndpointSchema.safeParse({
      ...valid,
      headers: { 'X-Provider-Token': 'sk-or-abcdef0123456789' },
    });
    expect(r.success).toBe(false);
  });

  it('REJECTS a reserved header NAME (authorization) at parse', () => {
    // H1: a config header may never set authorization — the kernel writes it,
    // and it must always win. Reject the NAME outright at the config boundary.
    const r = EndpointSchema.safeParse({
      ...valid,
      headers: { authorization: 'Bearer whatever' },
    });
    expect(r.success).toBe(false);
  });

  it('REJECTS a reserved header NAME (Host, case-insensitive) at parse', () => {
    // A `Host:` header enables routing tricks; rejected regardless of casing.
    expect(EndpointSchema.safeParse({ ...valid, headers: { Host: 'evil.example' } }).success).toBe(
      false,
    );
    expect(
      EndpointSchema.safeParse({ ...valid, headers: { 'CONTENT-TYPE': 'text/plain' } }).success,
    ).toBe(false);
  });

  it('accepts benign static headers', () => {
    const r = EndpointSchema.safeParse({ ...valid, headers: { 'HTTP-Referer': 'kernloop.dev' } });
    expect(r.success).toBe(true);
  });

  it('REJECTS maxUsdPerCall without metersUsd:true (an inert cap)', () => {
    // H2: a spend cap on an unmetered endpoint would never be checked — reject
    // it at parse rather than imply a ceiling that does nothing.
    expect(EndpointSchema.safeParse({ ...valid, maxUsdPerCall: 0.5 }).success).toBe(false);
    expect(
      EndpointSchema.safeParse({ ...valid, metersUsd: false, maxUsdPerCall: 0.5 }).success,
    ).toBe(false);
    expect(
      EndpointSchema.safeParse({ ...valid, metersUsd: true, maxUsdPerCall: 0.5 }).success,
    ).toBe(true);
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

describe('ownKeyedEndpoints — null-proto membership safety (#474)', () => {
  it('returns undefined for a prototype-inherited key, so === undefined membership is sound', () => {
    const map = ownKeyedEndpoints({ real: EndpointSchema.parse(valid) });
    const asRecord = map as Record<string, unknown>;
    expect(map['real']).toBeDefined();
    // A plain object would return Object.prototype members for these — null-proto returns undefined.
    expect(asRecord['constructor']).toBeUndefined();
    expect(asRecord['toString']).toBeUndefined();
    expect(asRecord['valueOf']).toBeUndefined();
    expect(asRecord['__proto__']).toBeUndefined();
    // Own keys still iterate normally.
    expect(Object.keys(map)).toEqual(['real']);
  });
});
