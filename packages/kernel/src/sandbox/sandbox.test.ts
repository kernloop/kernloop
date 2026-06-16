/**
 * Sandbox primitive unit tests (#234, CLM-0052 ported): the docker argv
 * contract (pure, no docker needed), the `-v` option-injection guards, the
 * exec-profile boundary validation, and the refusal path when the docker
 * binary is absent — the primitive NEVER runs the command unsandboxed. The
 * profile here is a kernel-local exec fixture (the kernel does not depend on
 * any faculty's ratified profile); toolsmith's own test proves its ratified
 * profile drives this same primitive correctly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SandboxUnavailableError } from './errors.js';
import { SandboxExecProfileSchema, type SandboxExecProfile } from './profile.js';
import { buildDockerArgs, runInSandbox } from './sandbox.js';

/** A valid exec profile fixture (same shape the toolsmith ratified profile satisfies). */
const PROFILE: SandboxExecProfile = SandboxExecProfileSchema.parse({
  image: 'node:22-alpine',
  network: 'none',
  user: 'node',
  workdir: '/scratch',
  memory: '512m',
  cpus: 1,
  pidsLimit: 128,
  timeoutMs: 120_000,
});

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-sandbox-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildDockerArgs', () => {
  it('builds the full argv: no network, capped, scratch mount, workdir', () => {
    const scratch = tmpDir();
    const args = buildDockerArgs(
      { scratchDir: scratch, command: ['node', '--test', 'test.mjs'], profile: PROFILE },
      'kernloop-sandbox-x',
    );
    expect(args).toEqual([
      'run',
      '--rm',
      '--name',
      'kernloop-sandbox-x',
      '--network',
      'none',
      '--user',
      'node',
      '--memory',
      '512m',
      '--cpus',
      '1',
      '--pids-limit',
      '128',
      '-v',
      `${scratch}:/scratch`,
      '-w',
      '/scratch',
      'node:22-alpine',
      'node',
      '--test',
      'test.mjs',
    ]);
  });

  it('attaches every declared mount read-only, before the image', () => {
    const input = tmpDir();
    const args = buildDockerArgs(
      {
        scratchDir: tmpDir(),
        command: ['node', 'tool.mjs'],
        mounts: [{ source: input, target: '/inputs' }],
        profile: PROFILE,
      },
      'kernloop-sandbox-y',
    );
    expect(args).toContain(`${input}:/inputs:ro`);
    expect(args.indexOf(`${input}:/inputs:ro`)).toBeLessThan(args.indexOf('node:22-alpine'));
  });

  it('adds -i when stdin is provided, omits it otherwise', () => {
    const withStdin = buildDockerArgs(
      { scratchDir: tmpDir(), command: ['node', 't.mjs'], profile: PROFILE, stdin: '{"x":1}' },
      'z',
    );
    expect(withStdin.slice(0, 3)).toEqual(['run', '--rm', '-i']);
    const without = buildDockerArgs(
      { scratchDir: tmpDir(), command: ['node', 't.mjs'], profile: PROFILE },
      'w',
    );
    expect(without).not.toContain('-i');
  });

  it('rejects an invalid profile at the boundary (bad memory)', () => {
    expect(() =>
      buildDockerArgs(
        { scratchDir: tmpDir(), command: ['true'], profile: { ...PROFILE, memory: 'lots' } },
        'x',
      ),
    ).toThrow();
  });

  it('strips a structural superset profile (governance fields) and still validates exec knobs', () => {
    // A richer caller profile (extra fields) is accepted; the exec knobs win.
    const richer = { ...PROFILE, decayWindowDays: 30, liveToolCapPerOverlay: 12 };
    const args = buildDockerArgs({ scratchDir: tmpDir(), command: ['true'], profile: richer }, 'x');
    expect(args).toContain('--network');
    expect(args).toContain('none');
  });

  it('rejects a mount target carrying a colon (-v option injection)', () => {
    expect(() =>
      buildDockerArgs(
        {
          scratchDir: tmpDir(),
          command: ['true'],
          mounts: [{ source: tmpDir(), target: '/x:rw' }],
          profile: PROFILE,
        },
        'x',
      ),
    ).toThrow('colon-free');
  });

  it('rejects a relative mount target', () => {
    expect(() =>
      buildDockerArgs(
        {
          scratchDir: tmpDir(),
          command: ['true'],
          mounts: [{ source: tmpDir(), target: 'inputs' }],
          profile: PROFILE,
        },
        'x',
      ),
    ).toThrow('absolute');
  });
});

describe('runInSandbox refusal path', () => {
  it('refuses (typed) when the docker binary is absent instead of running unsandboxed', async () => {
    await expect(
      runInSandbox({
        scratchDir: tmpDir(),
        command: ['true'],
        profile: PROFILE,
        dockerBin: path.join(tmpDir(), 'no-such-docker'),
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});
