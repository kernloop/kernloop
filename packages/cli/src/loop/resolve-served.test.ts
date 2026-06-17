/**
 * resolveServedFor (#271) — the ONE served-model resolution rule shared by the
 * call-time binding (node-bind) and the identity-fitness prediction
 * (adapter-fitness), so predicted==served (CLM-0130) is guarded structurally.
 * These tests PIN the helper's contract: a CLI name resolves identically to a
 * bare resolveServed, a registered endpoint identically to the api path, and an
 * unknown name throws (the selector catches that and scores it neutral).
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequirement } from '@kernloop/contracts';
import { EndpointsSchema } from '../endpoints.js';
import { apiDefinitionFor } from '../endpoints.js';
import { resolveServed } from './node-seam.js';
import { resolveServedApi } from './api-seam.js';
import { resolveServedFor } from './resolve-served.js';

const REQ: ModelRequirement = { tier: 'large', effort: 'medium', capabilities: [] };

const ENDPOINTS = EndpointsSchema.parse({
  'my-endpoint': {
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'EXAMPLE_API_KEY',
    models: { large: 'acme/frodo-2' },
  },
});

describe('resolveServedFor — the single predicted==served rule (#271)', () => {
  it('a CLI name resolves identically to a bare resolveServed (no endpoint branch)', () => {
    expect(resolveServedFor(REQ, 'claude', {})).toEqual(resolveServed(REQ, 'claude'));
  });

  it('a registered endpoint resolves identically to the api path', () => {
    const expected = resolveServedApi(
      REQ,
      apiDefinitionFor('my-endpoint', ENDPOINTS['my-endpoint']!),
    );
    expect(resolveServedFor(REQ, 'my-endpoint', ENDPOINTS)).toEqual(expected);
    // And the endpoint branch genuinely diverges from the CLI branch for the name.
    expect(resolveServedFor(REQ, 'my-endpoint', ENDPOINTS).adapter).toBe('my-endpoint');
    expect(resolveServedFor(REQ, 'my-endpoint', ENDPOINTS).model).toBe('acme/frodo-2');
  });

  it('an unknown CLI adapter name throws (the selector catches → neutral)', () => {
    expect(() => resolveServedFor(REQ, 'no-such-adapter', {})).toThrow();
  });
});
