/**
 * ManifestRegistry suite (spec §3.1): schema-validated registration,
 * duplicate rejection, versioned lookup as the single source of capability
 * truth [CLM-0015], ratified removal (spec §3.2), and audit-event
 * assertions against the JSONL chain.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest } from '@kernloop/contracts';
import { createAuditStore, verifyChain, type AuditStore } from '../audit/index.js';
import type { AuditEnvelope } from '../audit/index.js';
import { ManifestRegistry, ManifestRegistryError } from './manifest-registry.js';

let dir: string;
let store: AuditStore;
let registry: ManifestRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-registry-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-09T00:00:00.000Z'),
  });
  registry = new ManifestRegistry(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manifest(name: string, version = '1.0.0', capability = 'compile-brief'): Manifest {
  return {
    name,
    version,
    kind: 'faculty',
    capabilities: [{ name: capability }],
    contracts: { consumes: ['TaskContract'], emits: ['Brief'] },
    cost: { tokens: 500, usd: 0.05, latencyMs: 2000 },
    tier: 'suggest',
    claims: [],
    maturity: 'experimental',
  };
}

function auditEvents(): AuditEnvelope[] {
  let text = '';
  try {
    text = readFileSync(store.filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEnvelope);
}

describe('registration [CLM-0015]', () => {
  it('registers a valid manifest and returns the validated record', () => {
    const m = registry.register(manifest('faculty-compiler'));
    expect(m.name).toBe('faculty-compiler');
    expect(registry.get('faculty-compiler')).toEqual(m);
  });

  it('rejects an invalid manifest at registration with a typed error', () => {
    const invalid = { ...manifest('faculty-bad'), tier: 'root' };
    expect(() => registry.register(invalid)).toThrowError(
      expect.objectContaining({ name: 'ManifestRegistryError', code: 'invalid_manifest' }) as Error,
    );
    expect(registry.list()).toHaveLength(0);
    expect(auditEvents()).toHaveLength(0);
  });

  it('rejects a non-object candidate with a typed error', () => {
    expect(() => registry.register('not a manifest')).toThrowError(ManifestRegistryError);
  });

  it('rejects a duplicate name@version registration with a typed error', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    expect(() => registry.register(manifest('faculty-compiler', '1.0.0'))).toThrowError(
      expect.objectContaining({ code: 'duplicate_manifest' }) as Error,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('stores multiple versions of the same name', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    registry.register(manifest('faculty-compiler', '1.1.0'));
    expect(
      registry
        .list()
        .map((m) => m.version)
        .sort(),
    ).toEqual(['1.0.0', '1.1.0']);
  });

  it('appends a kernel.registry.register audit event and the chain verifies', () => {
    registry.register(manifest('faculty-compiler'));
    const events = auditEvents();
    expect(events.map((e) => e.type)).toEqual(['kernel.registry.register']);
    expect(events[0]?.payload).toEqual({
      name: 'faculty-compiler',
      version: '1.0.0',
      kind: 'faculty',
      tier: 'suggest',
      maturity: 'experimental',
    });
    expect(verifyChain(store)).toEqual({ ok: true, length: 1 });
  });
});

describe('lookup is registered manifests only [CLM-0015]', () => {
  it('get returns the most recently registered version by default and an exact version on request', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    registry.register(manifest('faculty-compiler', '2.0.0'));
    expect(registry.get('faculty-compiler')?.version).toBe('2.0.0');
    expect(registry.get('faculty-compiler', '1.0.0')?.version).toBe('1.0.0');
  });

  it('get returns undefined for an unregistered name or version', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    expect(registry.get('faculty-ghost')).toBeUndefined();
    expect(registry.get('faculty-compiler', '9.9.9')).toBeUndefined();
  });

  it('list returns every registered manifest across names and versions', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    registry.register(manifest('faculty-compiler', '1.1.0'));
    registry.register(manifest('faculty-memory', '1.0.0', 'recall'));
    expect(registry.list()).toHaveLength(3);
  });

  it('findByCapability returns only registered manifests advertising the capability', () => {
    registry.register(manifest('faculty-compiler', '1.0.0', 'compile-brief'));
    registry.register(manifest('faculty-memory', '1.0.0', 'recall'));
    const matches = registry.findByCapability('recall');
    expect(matches.map((m) => m.name)).toEqual(['faculty-memory']);
    expect(registry.findByCapability('unregistered-capability')).toEqual([]);
  });
});

describe('removal requires ratification (spec §3.2)', () => {
  it('rejects removal without an explicit ratifiedBy with a typed error', () => {
    registry.register(manifest('faculty-compiler'));
    const removeUnratified = registry.remove.bind(registry) as (
      n: string,
      v: string,
      o?: unknown,
    ) => Manifest;
    expect(() => removeUnratified('faculty-compiler', '1.0.0')).toThrowError(
      expect.objectContaining({ code: 'ratification_required' }) as Error,
    );
    expect(() => registry.remove('faculty-compiler', '1.0.0', { ratifiedBy: '' })).toThrowError(
      expect.objectContaining({ code: 'ratification_required' }) as Error,
    );
    expect(registry.get('faculty-compiler')).toBeDefined();
  });

  it('removes a registered version with ratifiedBy and audits the ratifier', () => {
    registry.register(manifest('faculty-compiler', '1.0.0'));
    registry.register(manifest('faculty-compiler', '2.0.0'));
    const removed = registry.remove('faculty-compiler', '1.0.0', { ratifiedBy: 'williamz' });
    expect(removed.version).toBe('1.0.0');
    expect(registry.get('faculty-compiler', '1.0.0')).toBeUndefined();
    expect(registry.get('faculty-compiler')?.version).toBe('2.0.0');
    const events = auditEvents();
    expect(events.at(-1)?.type).toBe('kernel.registry.remove');
    expect(events.at(-1)?.payload).toEqual({
      name: 'faculty-compiler',
      version: '1.0.0',
      ratifiedBy: 'williamz',
    });
    expect(verifyChain(store).ok).toBe(true);
  });

  it('removing the last version of a name removes the name entirely', () => {
    registry.register(manifest('faculty-compiler'));
    registry.remove('faculty-compiler', '1.0.0', { ratifiedBy: 'williamz' });
    expect(registry.get('faculty-compiler')).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('rejects removal of an unregistered manifest with a typed error', () => {
    expect(() =>
      registry.remove('faculty-ghost', '1.0.0', { ratifiedBy: 'williamz' }),
    ).toThrowError(expect.objectContaining({ code: 'not_found' }) as Error);
  });
});
