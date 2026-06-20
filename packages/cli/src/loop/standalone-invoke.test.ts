/**
 * resolveStandaloneInvoke (#395): the standalone model-calling verbs
 * (gate/distill/forge/program-author) resolve `--adapter` to a CLI adapter OR a
 * registered endpoint id — so they run on an endpoint with no model CLI installed,
 * mirroring the #392 run-loop path. Routing + validation are HTTP-free; the model
 * BINDING (the core #395 behavior) is asserted against a localhost mock endpoint.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

/** A kernloop whose `my-api` endpoint points at `baseUrl` (the localhost mock). */
function kernAtBaseUrl(baseUrl: string): Kernloop {
  const overlayDir = path.join(scratch, '.kernloop');
  const cfg = [
    'id: standalone-bind-test',
    'endpoints:',
    '  my-api:',
    `    baseUrl: ${baseUrl}`,
    '    apiKeyEnv: MY_API_KEY',
    '    models: { large: served-large }',
    '',
  ].join('\n');
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), cfg);
  return createKernloop({ overlayDir });
}

// A localhost mock OpenAI-compatible endpoint that records the request body.
let server: Server;
let origin = '';
let lastBody = '';
beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastBody = raw;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => server.close());

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

  it('a frontier-ONLY endpoint fails at config-time with a tier+remedy hint, not a cryptic call-time error (#397)', () => {
    // resolveServedApi degrades DOWNWARD only, so binding only `frontier` leaves
    // the standalone `large` tier unresolved — error here, naming the fix.
    const overlayDir = path.join(scratch, '.kernloop');
    mkdirSync(overlayDir, { recursive: true });
    writeFileSync(
      path.join(overlayDir, 'overlay.yaml'),
      [
        'id: frontier-only',
        'endpoints:',
        '  big-only:',
        '    baseUrl: https://api.example.com/v1',
        '    apiKeyEnv: BIG_KEY',
        '    models: { frontier: huge-model }',
        '',
      ].join('\n'),
    );
    const kern = createKernloop({ overlayDir });
    expect(() => resolveStandaloneInvoke(kern, 'big-only')).toThrow(
      /binds no model for the `large`/,
    );
    expect(() => resolveStandaloneInvoke(kern, 'big-only')).toThrow(/endpoints\.big-only\.models/);
    kern.close();
  });

  it('PROBES a CLI adapter — an absent CLI is a typed error, never a stub', () => {
    const kern = kernWithEndpoint();
    expect(() => resolveStandaloneInvoke(kern, 'claude', { PATH: '/nonexistent' })).toThrow();
    kern.close();
  });

  it('BINDS the endpoint per-tier model into the call — the verb passes none (#395)', async () => {
    const kern = kernAtBaseUrl(`${origin}/v1`);
    const invoke = resolveStandaloneInvoke(kern, 'my-api', { MY_API_KEY: 'k' });
    lastBody = '';
    const { output } = await invoke('a prompt'); // the verb supplies NO model
    expect(output).toBe('ok');
    // The endpoint has no harness default, so the helper bound the `large`-tier model.
    expect((JSON.parse(lastBody) as { model?: string }).model).toBe('served-large');
    kern.close();
  });
});
