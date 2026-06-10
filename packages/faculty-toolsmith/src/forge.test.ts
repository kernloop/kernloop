/**
 * Birth-requirement and ordering tests for forge (CLM-0051, CLM-0053 cap) —
 * no docker needed: every refusal here fires BEFORE generation or any
 * docker call, proven by an invoke spy that stays uncalled and a bogus
 * docker binary that is never reached.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ForgeBirthError, SandboxProfileMismatchError, WorkshopCapError } from './errors.js';
import { forge } from './forge.js';
import { RATIFIED_SANDBOX_PROFILE, SandboxProfileSchema } from './profile.js';

const tmpDirs: string[] = [];
function overlay(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-forge-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const BOGUS_DOCKER = '/nonexistent/definitely-not-docker';

function validManifest(name = 'workshop/probe'): Record<string, unknown> {
  return {
    name,
    version: '0.1.0',
    kind: 'workshopTool',
    capabilities: [{ name: 'probe.run' }],
    contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
    cost: { tokens: 0, usd: 0, latencyMs: 100 },
    tier: 'suggest',
    claims: ['CLM-0051'],
    maturity: 'experimental',
  };
}

function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: { id: 'CLM-0051', statement: 'probe adds numbers' },
    acceptanceTest: 'import test from "node:test";\ntest("x", () => {});\n',
    manifest: validManifest(),
    ...overrides,
  };
}

async function expectBirthRefusal(spec: unknown): Promise<ForgeBirthError> {
  const invoke = vi.fn(async () => 'export const x = 1;\n');
  const error = await forge({ overlayDir: overlay(), spec, invoke, dockerBin: BOGUS_DOCKER }).then(
    () => {
      throw new Error('forge did not refuse');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ForgeBirthError);
  expect(invoke).not.toHaveBeenCalled();
  return error as ForgeBirthError;
}

describe('forge birth requirements (CLM-0051)', () => {
  it('refuses a spec missing its claim entry before any generation or docker call', async () => {
    const error = await expectBirthRefusal(validSpec({ claim: undefined }));
    expect(error.problems.join(' ')).toContain('spec.claim');
  });

  it('refuses a spec missing its acceptance test', async () => {
    const error = await expectBirthRefusal(validSpec({ acceptanceTest: undefined }));
    expect(error.problems.join(' ')).toContain('spec.acceptanceTest');
  });

  it('refuses a spec missing its manifest', async () => {
    const error = await expectBirthRefusal(validSpec({ manifest: undefined }));
    expect(error.problems.join(' ')).toContain('spec.manifest');
  });

  it('refuses a manifest whose kind is not workshopTool', async () => {
    const error = await expectBirthRefusal(
      validSpec({ manifest: { ...validManifest(), kind: 'skill' } }),
    );
    expect(error.problems.join(' ')).toContain("kind must be 'workshopTool'");
  });

  it('refuses a manifest born above suggest', async () => {
    const error = await expectBirthRefusal(
      validSpec({ manifest: { ...validManifest(), tier: 'enforce' } }),
    );
    expect(error.problems.join(' ')).toContain("tier must be 'suggest'");
  });

  it('refuses a manifest name outside the workshop namespace', async () => {
    const error = await expectBirthRefusal(validSpec({ manifest: validManifest('kernel/evil') }));
    expect(error.problems.join(' ')).toContain('workshop');
  });

  it('refuses a path-traversal name inside the workshop namespace', async () => {
    await expectBirthRefusal(validSpec({ manifest: validManifest('workshop/../evil') }));
  });

  it('refuses an overlay-invalid claim id', async () => {
    const error = await expectBirthRefusal(
      validSpec({ claim: { id: 'not a claim id', statement: 'x' } }),
    );
    expect(error.problems.join(' ')).toContain('claim id');
  });

  it('refuses when no model generator is injected', async () => {
    const error = await forge({
      overlayDir: overlay(),
      spec: validSpec(),
      dockerBin: BOGUS_DOCKER,
    }).then(
      () => {
        throw new Error('forge did not refuse');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForgeBirthError);
    expect((error as ForgeBirthError).problems.join(' ')).toContain('invoke');
  });
});

describe('forge ratified-profile gate (CLM-0052)', () => {
  it('refuses an active profile whose hash differs from the ratified hash', async () => {
    const invoke = vi.fn(async () => 'export const x = 1;\n');
    const tampered = SandboxProfileSchema.parse({
      ...RATIFIED_SANDBOX_PROFILE,
      timeoutMs: 5,
    });
    await expect(
      forge({
        overlayDir: overlay(),
        spec: validSpec(),
        invoke,
        profile: tampered,
        dockerBin: BOGUS_DOCKER,
      }),
    ).rejects.toBeInstanceOf(SandboxProfileMismatchError);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('forge cap (CLM-0053)', () => {
  it('refuses to forge at the 12-tool cap and names retire() as the way forward', async () => {
    const overlayDir = overlay();
    for (let i = 0; i < RATIFIED_SANDBOX_PROFILE.liveToolCapPerOverlay; i++) {
      const dir = path.join(overlayDir, 'workshop', `tool-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), '{}', 'utf8');
    }
    const invoke = vi.fn(async () => 'export const x = 1;\n');
    const error = await forge({
      overlayDir,
      spec: validSpec(),
      invoke,
      dockerBin: BOGUS_DOCKER,
    }).then(
      () => {
        throw new Error('forge did not refuse');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(WorkshopCapError);
    expect((error as WorkshopCapError).message).toContain('retire()');
    expect(invoke).not.toHaveBeenCalled();
  });
});
