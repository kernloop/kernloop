/**
 * Unit tests for the RUN path [CLM-0071, CLM-0072] with a SCRIPTED docker
 * double (an honest stand-in for the sandbox runtime — the real-docker path,
 * stdin streaming, and the advisory promotion through real runs are proven in
 * run.docker.test.ts). Everything between the docker seam and the ladder is
 * real: tool resolution, the stdin→stdout JSON contract, clean/unclean
 * classification, recordRun wiring, and the typed unknown-tool refusal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UnknownToolError } from './errors.js';
import { loadLifecycle, registerTool } from './lifecycle.js';
import { runWorkshopTool } from './run.js';

const dirs: string[] = [];
function overlay(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-run-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Hand-install a workshop tool: its tool.mjs source + a born lifecycle. */
function install(overlayDir: string, name: string, source: string): void {
  const dir = path.join(overlayDir, 'workshop', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tool.mjs'), source, 'utf8');
  registerTool({ overlayDir, name, at: 1_000 });
}

/**
 * A scripted docker that emits the given line on stdout and exits with the
 * given code — the sandbox runtime seam. It ignores its argv entirely; the
 * argv contract and real execution are covered elsewhere.
 */
function scriptedDocker(overlayDir: string, line: string, exitCode: number): string {
  const file = path.join(overlayDir, `docker-${exitCode}`);
  // The double prints `line` raw (so we can feed it non-JSON to prove the
  // unclean path) and exits with the scripted code.
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(line)});\nprocess.exit(${exitCode});\n`,
    { mode: 0o755 },
  );
  return file;
}

describe('runWorkshopTool', () => {
  it('a clean run parses the stdout contract and records a clean run on the ladder', async () => {
    const overlayDir = overlay();
    install(overlayDir, 'echo', 'process.stdin.pipe(process.stdout);');
    const result = await runWorkshopTool({
      overlayDir,
      name: 'echo',
      input: { x: 1 },
      dockerBin: scriptedDocker(overlayDir, JSON.stringify({ ok: true, x: 1 }), 0),
      now: 2_000,
    });
    expect(result.clean).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({ ok: true, x: 1 });
    expect(result.name).toBe('echo');
    const lifecycle = loadLifecycle(overlayDir);
    expect(lifecycle.tools['echo']?.cleanRuns).toBe(1);
    expect(lifecycle.tools['echo']?.lastUsedAt).toBe(2_000);
    expect(lifecycle.history.at(-1)).toMatchObject({ event: 'run', clean: true });
  });

  it('a non-zero exit is an unclean run — recorded, not thrown, output undefined', async () => {
    const overlayDir = overlay();
    install(overlayDir, 'crasher', 'process.exit(1);');
    const result = await runWorkshopTool({
      overlayDir,
      name: 'crasher',
      input: {},
      dockerBin: scriptedDocker(overlayDir, JSON.stringify({ ok: false }), 1),
      now: 3_000,
    });
    expect(result.clean).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toBeUndefined();
    expect(loadLifecycle(overlayDir).tools['crasher']?.cleanRuns).toBe(0);
  });

  it('exit 0 but non-JSON stdout is unclean: the contract was not honored', async () => {
    const overlayDir = overlay();
    install(overlayDir, 'proser', 'process.stdout.write("not json");');
    const result = await runWorkshopTool({
      overlayDir,
      name: 'proser',
      input: {},
      dockerBin: scriptedDocker(overlayDir, 'here is your answer, friend', 0),
      now: 4_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.clean).toBe(false);
    expect(result.output).toBeUndefined();
    expect(loadLifecycle(overlayDir).tools['proser']?.cleanRuns).toBe(0);
  });

  it('an unknown tool is a typed UnknownToolError, before any docker call', async () => {
    const overlayDir = overlay();
    await expect(
      runWorkshopTool({
        overlayDir,
        name: 'ghost',
        input: {},
        dockerBin: scriptedDocker(overlayDir, '{}', 0),
        now: 5_000,
      }),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });

  it('rejects an unsafe tool name with WorkshopNameError (path-traversal guard)', async () => {
    const overlayDir = overlay();
    await expect(
      runWorkshopTool({
        overlayDir,
        name: '../escape',
        input: {},
        dockerBin: scriptedDocker(overlayDir, '{}', 0),
        now: 6_000,
      }),
    ).rejects.toThrow(/unsafe workshop tool name/);
  });
});
