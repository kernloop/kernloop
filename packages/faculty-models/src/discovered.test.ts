/**
 * Acceptance tests for the discovered catalog [CLM-0087] — `mergeDiscovered`
 * (normalize discovered ids through the unchanged resolver), the machine-local
 * cache (`loadDiscoveredCache` defensive load, `upsertSource` replace-on-resync),
 * and `resolveWithDiscovered` (vendored table → discovered cache → rule →
 * unknown). Pure: no HTTP, no clock — the test supplies `syncedAt`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalog } from './catalog.js';
import {
  discoveredIndex,
  emptyDiscoveredCache,
  loadDiscoveredCache,
  mergeDiscovered,
  resolveWithDiscovered,
  upsertSource,
  type DiscoveredCache,
} from './discovered.js';

const NOW = '2026-06-11T00:00:00.000Z';
let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'discovered-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mergeDiscovered — normalize discovered ids through the unchanged resolver', () => {
  it('normalizes a vendored id by table, an uncatalogued id by rule, garbage by unknown', () => {
    const models = mergeDiscovered(catalog, ['opus', 'acme/llama-3', '!!garbage!!']);
    expect(models.map((m) => m.resolvedBy)).toEqual(['table', 'rule', 'unknown']);
    const table = models[0];
    expect(table?.raw).toBe('opus');
    expect(table?.contextWindow).not.toBeNull(); // table hit carries full metadata
    expect(models[1]?.contextWindow).toBeNull(); // rule parse → null metadata (no guess)
  });

  it('de-duplicates ids and drops the empty string (never a fabricated model)', () => {
    const models = mergeDiscovered(catalog, ['opus', 'opus', '']);
    expect(models).toHaveLength(1);
    expect(models[0]?.raw).toBe('opus');
  });
});

describe('upsertSource — REPLACES a source set (a vanished model does not persist)', () => {
  it('a re-sync of a source replaces its whole set, dropping a model no longer served', () => {
    let cache = emptyDiscoveredCache(NOW);
    cache = upsertSource(cache, 'endpoint-a', mergeDiscovered(catalog, ['opus', 'sonnet']), NOW);
    expect(discoveredIndex(cache).has('opus')).toBe(true);
    // Re-sync: the endpoint now serves only sonnet. opus must NOT persist.
    const later = '2026-06-12T00:00:00.000Z';
    cache = upsertSource(cache, 'endpoint-a', mergeDiscovered(catalog, ['sonnet']), later);
    const index = discoveredIndex(cache);
    expect(index.has('opus')).toBe(false); // vanished → gone (honesty)
    expect(index.has('sonnet')).toBe(true);
    expect(cache.sources['endpoint-a']?.syncedAt).toBe(later); // freshness recorded
  });

  it('keeps other sources untouched when one is re-synced', () => {
    let cache = emptyDiscoveredCache(NOW);
    cache = upsertSource(cache, 'endpoint-a', mergeDiscovered(catalog, ['opus']), NOW);
    cache = upsertSource(cache, 'ollama', mergeDiscovered(catalog, ['acme/llama-3']), NOW);
    cache = upsertSource(cache, 'endpoint-a', mergeDiscovered(catalog, ['sonnet']), NOW);
    expect(Object.keys(cache.sources).sort()).toEqual(['endpoint-a', 'ollama']);
    expect(discoveredIndex(cache).has('acme/llama-3')).toBe(true);
  });
});

describe('loadDiscoveredCache — defensive load (missing/corrupt → empty, never a crash)', () => {
  it('a missing file degrades to the empty cache stamped with now', () => {
    const cache = loadDiscoveredCache(path.join(dir, 'nope.json'), NOW);
    expect(cache).toEqual({ snapshot: NOW, sources: {} });
  });

  it('a corrupt (non-JSON) file degrades to the empty cache, not a throw', () => {
    const file = path.join(dir, 'cache.json');
    writeFileSync(file, '<<not json>>', 'utf8');
    expect(loadDiscoveredCache(file, NOW)).toEqual({ snapshot: NOW, sources: {} });
  });

  it('a schema-invalid cache degrades to the empty cache (honesty over half-load)', () => {
    const file = path.join(dir, 'cache.json');
    writeFileSync(file, JSON.stringify({ snapshot: NOW, sources: { x: { bogus: true } } }), 'utf8');
    expect(loadDiscoveredCache(file, NOW)).toEqual({ snapshot: NOW, sources: {} });
  });

  it('round-trips a valid cache through the file (write → load)', () => {
    const file = path.join(dir, 'cache.json');
    const cache = upsertSource(
      emptyDiscoveredCache(NOW),
      'a',
      mergeDiscovered(catalog, ['opus']),
      NOW,
    );
    writeFileSync(file, JSON.stringify(cache), 'utf8');
    const loaded: DiscoveredCache = loadDiscoveredCache(file, '2099-01-01T00:00:00.000Z');
    expect(loaded.sources['a']?.models[0]?.raw).toBe('opus');
    expect(loaded.snapshot).toBe(NOW); // the file's stamp wins, not the fallback
  });
});

describe('resolveWithDiscovered — vendored table → discovered cache → rule → unknown', () => {
  it('a vendored table hit always wins (the reviewed snapshot is most trusted)', () => {
    const cache = emptyDiscoveredCache(NOW);
    const id = resolveWithDiscovered('opus', catalog, cache);
    expect(id.resolvedBy).toBe('table');
  });

  it('a DISCOVERED uncatalogued id normalizes by the cache, not a bare rule parse', () => {
    const cache = upsertSource(
      emptyDiscoveredCache(NOW),
      'a',
      mergeDiscovered(catalog, ['acme/llama-3']),
      NOW,
    );
    const id = resolveWithDiscovered('acme/llama-3', catalog, cache);
    expect(id.raw).toBe('acme/llama-3');
    expect(id.resolvedBy).toBe('rule'); // its cached normalization (consulted, not re-derived blindly)
  });

  it('an id neither catalogued nor discovered falls through to rule → unknown', () => {
    const cache = emptyDiscoveredCache(NOW);
    expect(resolveWithDiscovered('!!junk!!', catalog, cache).resolvedBy).toBe('unknown');
    expect(resolveWithDiscovered('acme/llama-3', catalog, cache).resolvedBy).toBe('rule');
  });
});
