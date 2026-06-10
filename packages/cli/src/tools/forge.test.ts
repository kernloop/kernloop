/**
 * Unit tests for the `forge` tool [CLM-0058]: the toolsmith birth path
 * bound to the adapter seam, with a scripted invoke (honest double for the
 * model CLI) and a scripted docker binary via the toolsmith's exported
 * dockerBin injection (honest double for the sandbox runtime — the argv
 * contract and the real-docker path are proven in faculty-toolsmith's own
 * suites). Everything between the two seams is real: birth validation,
 * profile hash gate, install, registry + ladder registration, audit.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { ForgeBirthError, ForgeTestFailedError } from '@kernloop/faculty-toolsmith';
import type { Cost } from '@kernloop/contracts';
import { createKernloop, type Kernloop } from '../kernel.js';
import { LoopParseError, type LoopInvoke } from '../loop/invoke.js';
import { readEnvelopes } from './audit.js';
import { forgeTool } from './forge.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-forge-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshKernloop(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}

/** A scripted docker: prints one line and exits with the given code. */
function scriptedDocker(repo: string, exitCode: number): string {
  const file = path.join(repo, `docker-exit-${String(exitCode)}`);
  writeFileSync(
    file,
    `#!/usr/bin/env node\nprocess.stdout.write('sandboxed test run\\n');\nprocess.exit(${String(exitCode)});\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

const ZERO_COST: Cost = { tokens: 0, usd: 0 };
const SOURCE = 'export function add(a, b) {\n  return a + b;\n}\n';

/** Scripted invoke answering the strict {"source": …} contract. */
function scriptedInvoke(output: string, prompts: string[] = []): LoopInvoke {
  return (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ output, cost: ZERO_COST });
  };
}

/** A complete, valid birth certificate. */
function toolSpec(name: string): Record<string, unknown> {
  return {
    claim: { id: 'CLM-0058', statement: `${name} adds two numbers` },
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
      claims: ['CLM-0058'],
      maturity: 'experimental',
    },
  };
}

describe('forgeTool', () => {
  it('births a workshop tool: generation via the adapter seam, sandbox pass, install, registry + ladder + audit', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    const prompts: string[] = [];
    const result = await forgeTool(
      kern,
      { spec: toolSpec('adder') },
      {
        invoke: scriptedInvoke(JSON.stringify({ source: SOURCE }), prompts),
        dockerBin: scriptedDocker(repo, 0),
      },
    );
    // the generation prompt carried the real birth certificate
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('CLM-0058');
    expect(prompts[0]).toContain('workshop/adder');
    // installed under the overlay workshop namespace with the full record
    expect(result.name).toBe('adder');
    expect(result.dir).toBe(path.join(kern.paths.dir, 'workshop', 'adder'));
    for (const file of ['tool.mjs', 'test.mjs', 'manifest.json', 'claim.yaml']) {
      expect(existsSync(path.join(result.dir, file))).toBe(true);
    }
    // registered as a workshop/* manifest at suggest tier — never tool #12
    expect(kern.registry.get('workshop/adder')?.tier).toBe('suggest');
    const envelopes = readEnvelopes(kern.paths.audit);
    const tierChange = envelopes.find(
      (e) =>
        e.type === 'kernel.ladder.tier_change' &&
        (e.payload as { manifest: string }).manifest === 'workshop/adder',
    );
    expect(tierChange?.payload).toMatchObject({ to: 'suggest' });
    // the build is audited with its provenance, and the chain verifies
    const build = envelopes.find((e) => e.type === 'cli.forge.build');
    expect(build?.payload).toMatchObject({
      name: 'workshop/adder',
      profileHash: result.profileHash,
      generator: 'adapter:claude',
      tier: 'suggest',
    });
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('reads the spec from --spec-file', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    const specFile = path.join(repo, 'tool-spec.json');
    writeFileSync(specFile, JSON.stringify(toolSpec('filespec')), 'utf8');
    const result = await forgeTool(
      kern,
      { specFile },
      {
        invoke: scriptedInvoke(JSON.stringify({ source: SOURCE })),
        dockerBin: scriptedDocker(repo, 0),
      },
    );
    expect(result.manifest.name).toBe('workshop/filespec');
    kern.close();
  });

  it('a red sandbox test installs and registers NOTHING — the typed failure surfaces', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    const error = await forgeTool(
      kern,
      { spec: toolSpec('broken') },
      {
        invoke: scriptedInvoke(JSON.stringify({ source: SOURCE })),
        dockerBin: scriptedDocker(repo, 1),
      },
    ).then(
      () => {
        throw new Error('forgeTool did not refuse');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForgeTestFailedError);
    dirs.push((error as ForgeTestFailedError).scratchDir);
    expect(existsSync(path.join(kern.paths.dir, 'workshop', 'broken'))).toBe(false);
    expect(kern.registry.get('workshop/broken')).toBeUndefined();
    expect(readEnvelopes(kern.paths.audit).some((e) => e.type === 'cli.forge.build')).toBe(false);
    kern.close();
  });

  it('surfaces the toolsmith birth refusal before any generation', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    const prompts: string[] = [];
    await expect(
      forgeTool(
        kern,
        { spec: { claim: { id: 'CLM-0058', statement: 'incomplete' } } },
        { invoke: scriptedInvoke('irrelevant', prompts), dockerBin: scriptedDocker(repo, 0) },
      ),
    ).rejects.toThrow(ForgeBirthError);
    expect(prompts).toHaveLength(0);
    kern.close();
  });

  it('a generation that violates the source contract is a typed parse error, raw output preserved', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await expect(
      forgeTool(
        kern,
        { spec: toolSpec('proser') },
        { invoke: scriptedInvoke('here is your tool, enjoy!'), dockerBin: scriptedDocker(repo, 0) },
      ),
    ).rejects.toThrow(LoopParseError);
    kern.close();
  });

  it('requires exactly one of spec and specFile', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await expect(forgeTool(kern, {}, { invoke: scriptedInvoke('{}') })).rejects.toThrow(
      /exactly one of spec or specFile/,
    );
    await expect(
      forgeTool(
        kern,
        { spec: toolSpec('x'), specFile: 'also.json' },
        { invoke: scriptedInvoke('{}') },
      ),
    ).rejects.toThrow(/exactly one of spec or specFile/);
    kern.close();
  });
});
