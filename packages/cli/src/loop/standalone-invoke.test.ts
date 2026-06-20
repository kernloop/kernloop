/**
 * resolveStandaloneInvoke (#395): the standalone model-calling verbs
 * (gate/distill/forge/program-author) resolve `--adapter` to a CLI adapter OR a
 * registered endpoint id — so they run on an endpoint with no model CLI installed,
 * mirroring the #392 run-loop path. These cover the ROUTING + validation without a
 * real HTTP call; the api invocation itself is covered by api-seam tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from '../kernel.js';
import { resolveStandaloneInvoke } from './standalone-invoke.js';

let scratch = '';

/** A kernloop whose overlay registers an endpoint id `my-api` with a per-tier model. */
function kernWithEndpoint(): Kernloop {
  const overlayDir = path.join(scratch, '.kernloop');
  const cfg = [
    'id: standalone-test',
    'endpoints:',
    '  my-api:',
    '    baseUrl: https://api.example.com/v1',
    '    apiKeyEnv: MY_API_KEY',
    '    models: { large: served-large }',
    '',
  ].join('\n');
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), cfg);
  return createKernloop({ overlayDir });
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'standalone-invoke-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('resolveStandaloneInvoke (#395)', () => {
  it('accepts a registered endpoint id WITHOUT a CLI PATH-probe (no CLI installed)', () => {
    const kern = kernWithEndpoint();
    // An endpoint is non-CLI: even with an empty PATH it resolves (no probe), and
    // returns a callable invoke bound to the endpoint's api seam.
    const invoke = resolveStandaloneInvoke(kern, 'my-api', { PATH: '/nonexistent' });
    expect(typeof invoke).toBe('function');
    kern.close();
  });

  it('throws for an adapter that is neither a CLI adapter nor a registered endpoint', () => {
    const kern = kernWithEndpoint();
    expect(() => resolveStandaloneInvoke(kern, 'gpt-12')).toThrow('neither a CLI adapter');
    kern.close();
  });

  it('PROBES a CLI adapter — an absent CLI is a typed error, never a stub', () => {
    const kern = kernWithEndpoint();
    expect(() => resolveStandaloneInvoke(kern, 'claude', { PATH: '/nonexistent' })).toThrow();
    kern.close();
  });
});
