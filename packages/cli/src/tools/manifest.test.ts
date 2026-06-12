/**
 * Unit tests for the `manifest` tool: registry list/get/register through
 * the kernel's single source of capability truth.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManifestRegistryError } from '@kernloop/kernel';
import { createKernloop, type Kernloop } from '../kernel.js';
import { manifestTool } from './manifest.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-manifest-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const EXTRA_MANIFEST = {
  name: 'example-skill',
  version: '0.0.1',
  kind: 'skill',
  capabilities: [{ name: 'example.noop' }],
  contracts: { consumes: [], emits: [] },
  cost: { tokens: 0, usd: 0, latencyMs: 1 },
  tier: 'suggest',
  claims: [],
  maturity: 'experimental',
};

describe('manifestTool', () => {
  it('lists the registered manifests', () => {
    const kern = freshKernloop();
    const result = manifestTool(kern, { op: 'list' });
    if (result.op !== 'list') throw new Error('expected list');
    expect(result.manifests).toHaveLength(9);
    kern.close();
  });

  it('gets one manifest by name, and reports not-found honestly', () => {
    const kern = freshKernloop();
    const found = manifestTool(kern, { op: 'get', name: '@kernloop/faculty-gates' });
    expect(found).toMatchObject({ op: 'get', found: true });
    const missing = manifestTool(kern, { op: 'get', name: 'nope' });
    expect(missing).toEqual({ op: 'get', found: false, name: 'nope' });
    kern.close();
  });

  it('registers a schema-valid manifest and rejects duplicates via the registry', () => {
    const kern = freshKernloop();
    const result = manifestTool(kern, { op: 'register', manifest: EXTRA_MANIFEST });
    if (result.op !== 'register') throw new Error('expected register');
    expect(result.registered.name).toBe('example-skill');
    expect(() => manifestTool(kern, { op: 'register', manifest: EXTRA_MANIFEST })).toThrow(
      ManifestRegistryError,
    );
    kern.close();
  });

  it('rejects schema-invalid input at the tool boundary', () => {
    const kern = freshKernloop();
    expect(() =>
      manifestTool(kern, { op: 'register', manifest: { name: 'broken' } } as never),
    ).toThrow();
    kern.close();
  });
});
