/**
 * Real-docker birth-path proofs: a passing tool installs with its full birth
 * record (CLM-0052); a failing one never installs and leaves its scratch dir
 * for diagnosis; a tool that tries to import kernel internals dies in the
 * sandbox — the physical enforcement behind CLM-0053's isolation clause.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForgeTestFailedError } from './errors.js';
import { forge, type ToolSpec } from './forge.js';
import { loadLifecycle } from './lifecycle.js';
import { RATIFIED_PROFILE_HASH, RATIFIED_SANDBOX_PROFILE } from './profile.js';
import { listTools } from './workshop.js';

const tmpDirs: string[] = [];
function overlay(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-forge-docker-'));
  tmpDirs.push(dir);
  return dir;
}

beforeAll(() => {
  execFileSync('docker', ['pull', RATIFIED_SANDBOX_PROFILE.image], { stdio: 'ignore' });
});
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function spec(name: string): ToolSpec {
  return {
    claim: { id: 'CLM-0051', statement: `${name} adds two numbers` },
    acceptanceTest:
      'import test from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { add } from "./tool.mjs";\n' +
      'test("adds", () => { assert.equal(add(2, 3), 5); });\n',
    manifest: {
      name: `workshop/${name}`,
      version: '0.1.0',
      kind: 'workshopTool',
      capabilities: [{ name: `${name}.run` }],
      contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
      cost: { tokens: 0, usd: 0, latencyMs: 100 },
      tier: 'suggest',
      claims: ['CLM-0051'],
      maturity: 'experimental',
    },
  };
}

const GOOD_SOURCE = 'export function add(a, b) {\n  return a + b;\n}\n';

describe('forge (real docker)', () => {
  it('installs a tool only after its acceptance test passes inside the sandbox', async () => {
    const overlayDir = overlay();
    const result = await forge({
      overlayDir,
      spec: spec('adder'),
      invoke: async () => GOOD_SOURCE,
      clock: () => 1750000000000,
    });
    expect(result.name).toBe('adder');
    expect(result.profileHash).toBe(RATIFIED_PROFILE_HASH);
    expect(result.sandbox.exitCode).toBe(0);
    const dir = path.join(overlayDir, 'workshop', 'adder');
    expect(result.dir).toBe(dir);
    for (const file of ['tool.mjs', 'test.mjs', 'manifest.json', 'claim.yaml']) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, 'tool.mjs'), 'utf8')).toBe(GOOD_SOURCE);
    expect(fs.readFileSync(path.join(dir, 'claim.yaml'), 'utf8')).toContain('CLM-0051');
    expect(listTools(overlayDir).map((t) => t.name)).toEqual(['adder']);
    const lifecycle = loadLifecycle(overlayDir);
    expect(lifecycle.tools['adder']).toMatchObject({
      tier: 'suggest',
      cleanRuns: 0,
      born: 1750000000000,
      status: 'live',
    });
    expect(lifecycle.history[0]).toMatchObject({ tool: 'adder', event: 'born', to: 'suggest' });
  });

  it('a failing acceptance test installs nothing and preserves scratch for diagnosis', async () => {
    const overlayDir = overlay();
    const error = await forge({
      overlayDir,
      spec: spec('broken'),
      invoke: async () => 'export function add(a, b) {\n  return a - b;\n}\n',
    }).then(
      () => {
        throw new Error('forge did not refuse');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForgeTestFailedError);
    const failed = error as ForgeTestFailedError;
    expect(failed.exitCode).not.toBe(0);
    expect(failed.message).toContain(failed.scratchDir);
    expect(fs.existsSync(path.join(failed.scratchDir, 'tool.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(failed.scratchDir, 'test.mjs'))).toBe(true);
    expect(listTools(overlayDir)).toEqual([]);
    expect(fs.existsSync(path.join(overlayDir, 'workshop', 'broken'))).toBe(false);
    tmpDirs.push(failed.scratchDir);
  });

  it('a tool importing @kernloop/kernel fails its sandbox test — physical isolation', async () => {
    // The sandbox has no node_modules and no network: any import beyond node
    // builtins and the tool's own files cannot resolve. That, not a lint,
    // is what enforces "cannot import kernel/faculty internals" (CLM-0053).
    const overlayDir = overlay();
    const error = await forge({
      overlayDir,
      spec: spec('escapee'),
      invoke: async () =>
        'await import("@kernloop/kernel");\nexport function add(a, b) {\n  return a + b;\n}\n',
    }).then(
      () => {
        throw new Error('forge did not refuse');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForgeTestFailedError);
    expect(listTools(overlayDir)).toEqual([]);
    tmpDirs.push((error as ForgeTestFailedError).scratchDir);
  });
});
