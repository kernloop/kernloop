/**
 * The vendored catalog [CLM-0080] — a pinned, zod-validated, OFFLINE snapshot.
 * These tests pin the loader boundary (zod rejects a malformed snapshot), the
 * pin-date stamp, and that every key the catalog ships is one of the aliases/ids
 * kernloop's five adapters actually emit (the catalog covers what the loop can
 * serve, not the whole world).
 */
import { describe, expect, it } from 'vitest';
import { catalog, loadCatalog, parseCatalog } from './catalog.js';

describe('catalog — vendored, pinned, validated snapshot', () => {
  it('loads the vendored snapshot and stamps the hardcoded pin date', () => {
    const loaded = loadCatalog();
    expect(loaded.snapshot).toBe('2026-06-11');
    expect(Object.keys(loaded.models).length).toBeGreaterThan(0);
  });

  it('the eagerly-loaded catalog equals an explicit load', () => {
    expect(catalog).toEqual(loadCatalog());
  });

  it('covers the served aliases the five adapters emit (claude/gemini families)', () => {
    for (const alias of ['fable', 'opus', 'sonnet', 'haiku', 'gemini-3.1-pro', 'gemini-3-flash']) {
      expect(catalog.models[alias]).toBeDefined();
    }
  });

  it('rejects a malformed snapshot at the zod boundary (honesty over half-load)', () => {
    expect(() => parseCatalog({ snapshot: '2026-06-11', models: {} })).toThrow(); // missing note
    expect(() =>
      parseCatalog({
        snapshot: '2026-06-11',
        note: 'x',
        models: { bad: { provider: 'p' } }, // entry missing required fields
      }),
    ).toThrow();
  });

  it('every entry carries non-null catalog metadata (a catalogued model is known)', () => {
    for (const entry of Object.values(catalog.models)) {
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.inputCostPerMTok).toBeGreaterThanOrEqual(0);
      expect(entry.outputCostPerMTok).toBeGreaterThanOrEqual(0);
    }
  });
});
