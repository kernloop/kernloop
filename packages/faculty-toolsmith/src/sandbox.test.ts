/**
 * Unit tests for the sandbox: the docker argv contract (pure, no docker
 * needed) and the refusal paths — docker binary absent and daemon down both
 * throw SandboxUnavailableError; generated code NEVER runs unsandboxed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SandboxUnavailableError } from './errors.js';
import { RATIFIED_SANDBOX_PROFILE } from './profile.js';
import { buildDockerArgs, runInSandbox } from './sandbox.js';

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-sandbox-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildDockerArgs', () => {
  it('builds the full ratified argv: no network, node user, caps, scratch mount, workdir', () => {
    const scratch = tmpDir();
    const args = buildDockerArgs(
      {
        scratchDir: scratch,
        command: ['node', '--test', 'test.mjs'],
        profile: RATIFIED_SANDBOX_PROFILE,
      },
      'kernloop-forge-x',
    );
    expect(args).toEqual([
      'run',
      '--rm',
      '--name',
      'kernloop-forge-x',
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

  it('attaches every declared mount read-only', () => {
    const scratch = tmpDir();
    const input = tmpDir();
    const args = buildDockerArgs(
      {
        scratchDir: scratch,
        command: ['node', 'tool.mjs'],
        mounts: [{ source: input, target: '/inputs' }],
        profile: RATIFIED_SANDBOX_PROFILE,
      },
      'kernloop-forge-y',
    );
    expect(args).toContain(`${input}:/inputs:ro`);
    // The read-only mount precedes the image; nothing follows the command.
    expect(args.indexOf(`${input}:/inputs:ro`)).toBeLessThan(args.indexOf('node:22-alpine'));
  });

  it('rejects an invalid profile at the boundary', () => {
    expect(() =>
      buildDockerArgs(
        {
          scratchDir: tmpDir(),
          command: ['true'],
          profile: { ...RATIFIED_SANDBOX_PROFILE, memory: 'lots' },
        },
        'x',
      ),
    ).toThrow();
  });

  it('rejects a mount target carrying a colon (-v option injection)', () => {
    expect(() =>
      buildDockerArgs(
        {
          scratchDir: tmpDir(),
          command: ['true'],
          mounts: [{ source: tmpDir(), target: '/x:rw' }],
          profile: RATIFIED_SANDBOX_PROFILE,
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
          profile: RATIFIED_SANDBOX_PROFILE,
        },
        'x',
      ),
    ).toThrow('absolute');
  });
});

describe('runInSandbox refusal paths', () => {
  it('refuses to run when the docker binary is absent instead of running unsandboxed', async () => {
    await expect(
      runInSandbox({
        scratchDir: tmpDir(),
        command: ['node', '-e', 'process.exit(0)'],
        profile: RATIFIED_SANDBOX_PROFILE,
        dockerBin: '/nonexistent/definitely-not-docker',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('refuses when the docker daemon is unreachable', async () => {
    const dir = tmpDir();
    const fakeDocker = path.join(dir, 'docker');
    fs.writeFileSync(
      fakeDocker,
      '#!/bin/sh\necho "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    await expect(
      runInSandbox({
        scratchDir: tmpDir(),
        command: ['node', '-e', 'process.exit(0)'],
        profile: RATIFIED_SANDBOX_PROFILE,
        dockerBin: fakeDocker,
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});
