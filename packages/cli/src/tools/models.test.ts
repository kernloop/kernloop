/**
 * Acceptance tests for `kernloop models sync` / `models list` [CLM-0086,
 * CLM-0087, CLM-0088] — the CLI surface of model discovery.
 *
 * A REAL ephemeral localhost server stands in for BOTH an OpenAI-compatible
 * endpoint (`/v1/models`) AND the ollama daemon (`/api/tags`) — no real network.
 * `http://127.0.0.1` is the SSRF guard's allowed local path. A fixed clock makes
 * the synced-at stamp deterministic; a fake key proves the key never reaches the
 * audit, the result, or stdout.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readEnvelopes } from './audit.js';
import { modelsListTool, modelsSyncTool } from './models.js';
import { createKernloop, type Kernloop } from '../kernel.js';

const KEY_ENV = 'MODELS_SYNC_TEST_KEY';
const FAKE_KEY = 'sk-models-sync-LEAKME-0123456789abcdef';
const CLOCK = new Date('2026-06-11T12:00:00.000Z');

/** The mock server's per-request behavior, swappable between tests. */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let origin = '';
let handler: Handler;
let scratch = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => handler(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => server.close());

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'models-sync-'));
  process.env[KEY_ENV] = FAKE_KEY;
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  delete process.env[KEY_ENV];
});

/** A kernloop over a temp overlay that registers the endpoint at the mock `/v1` base. */
function kernWithEndpoint(): Kernloop {
  const overlayDir = path.join(scratch, '.kernloop');
  const cfg = [
    'id: models-sync-test',
    'endpoints:',
    '  internal:',
    `    baseUrl: ${origin}/v1`,
    `    apiKeyEnv: ${KEY_ENV}`,
    '    models: { large: served-large }',
    '',
  ].join('\n');
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), cfg);
  return createKernloop({ overlayDir, clock: () => CLOCK });
}

/** Default handler: the endpoint lists two models, ollama lists one. */
function listingHandler(): Handler {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/v1/models') {
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'opus', object: 'model', created: 1, owned_by: 'org' },
            { id: 'acme/llama-3', object: 'model', created: 1, owned_by: 'org' },
          ],
        }),
      );
    } else if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'qwen2:7b', model: 'qwen2:7b', size: 1 }] }));
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  };
}

describe('modelsSyncTool — discovers, normalizes, persists, audits', () => {
  it('syncs an endpoint + ollama into the cache and reports per-source counts', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, ollamaHost: origin });
      expect(result.syncedAt).toBe(CLOCK.toISOString());
      const api = result.sources.find((s) => s.source === 'internal');
      expect(api).toMatchObject({ ok: true, discovered: 2, catalogued: 1 }); // opus is vendored
      const ollama = result.sources.find((s) => s.source === 'ollama');
      expect(ollama).toMatchObject({ ok: true, discovered: 1 });
      // the cache file was written and is valid JSON with both sources
      const cache = JSON.parse(readFileSync(result.cache, 'utf8')) as {
        sources: Record<string, { models: { raw: string }[] }>;
      };
      expect(cache.sources['internal']?.models.map((m) => m.raw)).toEqual(['opus', 'acme/llama-3']);
      expect(cache.sources['ollama']?.models[0]?.raw).toBe('qwen2:7b');
    } finally {
      kern.close();
    }
  });

  it('audits a cli.models.sync event with counts but NEVER the key', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      await modelsSyncTool(kern, { skipCliLive: true, ollamaHost: origin });
      const events = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.models.sync');
      expect(events).toHaveLength(1);
      const blob = JSON.stringify(events[0]);
      expect(blob).toContain('"discovered":2');
      expect(blob).not.toContain(FAKE_KEY); // the key never reaches the audit chain
    } finally {
      kern.close();
    }
  });

  it('the key NEVER leaks into the sync RESULT (no-leak on the discovery path)', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, ollamaHost: origin });
      const blob = JSON.stringify(result) + readFileSync(result.cache, 'utf8');
      expect(blob).not.toContain(FAKE_KEY);
    } finally {
      kern.close();
    }
  });
});

describe('modelsSyncTool — honesty (per-source failure isolation, replace-on-resync)', () => {
  it('isolates a failed source: the endpoint fails, ollama still proceeds', async () => {
    handler = (req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(503);
        res.end('{}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen2:7b' }] }));
      }
    };
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, ollamaHost: origin });
      const api = result.sources.find((s) => s.source === 'internal');
      expect(api?.ok).toBe(false);
      expect(api?.error).toContain('AdapterExecutionError');
      expect(api?.error).not.toContain(FAKE_KEY); // failure reason carries no key
      expect(result.sources.find((s) => s.source === 'ollama')?.ok).toBe(true);
    } finally {
      kern.close();
    }
  });

  it('fails the source (not a crash) when its key env var is unset', async () => {
    handler = listingHandler();
    delete process.env[KEY_ENV];
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, skipOllama: true });
      const api = result.sources.find((s) => s.source === 'internal');
      expect(api?.ok).toBe(false);
      expect(api?.error).toContain('ApiKeyMissingError');
    } finally {
      kern.close();
    }
  });

  it('a re-sync REPLACES a source set — a vanished model does not persist', async () => {
    const kern = kernWithEndpoint();
    try {
      handler = listingHandler(); // first sync: opus + acme/llama-3
      await modelsSyncTool(kern, { skipCliLive: true, skipOllama: true, skipCliAdapters: true });
      // second sync: the endpoint now serves only acme/llama-3
      handler = (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'acme/llama-3' }] }));
      };
      await modelsSyncTool(kern, { skipCliLive: true, skipOllama: true, skipCliAdapters: true });
      const list = modelsListTool(kern);
      const discoveredIds = list.models.filter((m) => m.origin === 'discovered').map((m) => m.id);
      expect(discoveredIds).toEqual(['acme/llama-3']); // opus is gone (honesty)
    } finally {
      kern.close();
    }
  });
});

describe('modelsSyncTool — agent-CLI tier-binding sources (#131)', () => {
  it('maps each harness-routed adapter to a cli:<name> source of its declared tier-bindings', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, skipOllama: true });
      const claude = result.sources.find((s) => s.source === 'cli:claude');
      expect(claude).toMatchObject({ kind: 'cli', ok: true, error: null });
      // claude is harness-routed (frontier/large/medium/small → fable/opus/sonnet/haiku).
      const cache = JSON.parse(readFileSync(result.cache, 'utf8')) as {
        sources: Record<string, { models: { raw: string }[] }>;
      };
      const claudeIds = cache.sources['cli:claude']?.models.map((m) => m.raw) ?? [];
      expect(claudeIds).toContain('opus');
      expect(claudeIds).toContain('haiku');
    } finally {
      kern.close();
    }
  });

  it('a concrete-id adapter with no bindings (codex) honestly records an empty set, never fabricated', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, { skipCliLive: true, skipOllama: true });
      expect(result.sources.find((s) => s.source === 'cli:codex')).toMatchObject({
        ok: true,
        discovered: 0,
      });
    } finally {
      kern.close();
    }
  });

  it('--no-cli-adapters (skipCliAdapters) omits every cli:<name> source', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, {
        skipCliLive: true,
        skipOllama: true,
        skipCliAdapters: true,
      });
      expect(result.sources.some((s) => s.kind === 'cli')).toBe(false);
    } finally {
      kern.close();
    }
  });
});

describe('modelsSyncTool — live agent-CLI model-list probe (#131, CLM-0131)', () => {
  const okResult = (stdout: string): Promise<import('@kernloop/kernel').SubprocessResult> =>
    Promise.resolve({
      stdout,
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 5,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

  it('records a cli-live:<adapter> source from the probed model list', async () => {
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, {
        skipOllama: true,
        skipCliAdapters: true,
        cliRun: () => okResult('opencode/big-pickle\nopencode/mimo-v2.5-free\n'),
      });
      const live = result.sources.find((s) => s.kind === 'cli-live');
      expect(live?.source).toBe('cli-live:opencode');
      expect(live?.ok).toBe(true);
      expect(live?.discovered).toBe(2);
    } finally {
      kern.close();
    }
  });

  it('an absent/failed CLI is an honest per-source failure, not a fabricated list', async () => {
    const kern = kernWithEndpoint();
    try {
      const result = await modelsSyncTool(kern, {
        skipOllama: true,
        skipCliAdapters: true,
        cliRun: () => Promise.reject(new Error('spawn opencode ENOENT')),
      });
      const live = result.sources.find((s) => s.kind === 'cli-live');
      expect(live?.ok).toBe(false);
      expect(live?.discovered).toBe(0);
      expect(live?.error).toMatch(/AdapterExecutionError|ENOENT/);
    } finally {
      kern.close();
    }
  });

  it('skipCliLive omits the live probe entirely (no cli-live source, no spawn)', async () => {
    const kern = kernWithEndpoint();
    let spawned = false;
    try {
      const result = await modelsSyncTool(kern, {
        skipOllama: true,
        skipCliAdapters: true,
        skipCliLive: true,
        cliRun: () => {
          spawned = true;
          return okResult('opencode/x\n');
        },
      });
      expect(result.sources.some((s) => s.kind === 'cli-live')).toBe(false);
      expect(spawned).toBe(false);
    } finally {
      kern.close();
    }
  });
});

describe('modelsListTool — merged vendored + discovered catalog with freshness', () => {
  it('lists vendored rows always, and discovered rows with source + syncedAt', async () => {
    handler = listingHandler();
    const kern = kernWithEndpoint();
    try {
      await modelsSyncTool(kern, { skipCliLive: true, ollamaHost: origin });
      const list = modelsListTool(kern);
      expect(list.vendoredSnapshot).not.toBe('');
      expect(list.discoveredSnapshot).toBe(CLOCK.toISOString()); // freshness stated honestly
      const vendored = list.models.filter((m) => m.origin === 'vendored');
      expect(vendored.length).toBeGreaterThan(0);
      expect(vendored.every((m) => m.resolvedBy === 'table')).toBe(true);
      const discovered = list.models.find((m) => m.id === 'acme/llama-3');
      expect(discovered).toMatchObject({
        origin: 'discovered',
        source: 'internal',
        syncedAt: CLOCK.toISOString(),
        resolvedBy: 'rule',
      });
    } finally {
      kern.close();
    }
  });

  it('with no cache, lists only vendored rows and a null discovered snapshot', () => {
    const kern = kernWithEndpoint();
    try {
      const list = modelsListTool(kern);
      expect(list.discoveredSnapshot).toBeNull();
      expect(list.models.every((m) => m.origin === 'vendored')).toBe(true);
    } finally {
      kern.close();
    }
  });
});
