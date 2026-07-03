/**
 * Uniform invocation + metering acceptance tests (CLM-0020, CLM-0021).
 *
 * Real subprocesses throughout: each test points PATH at a temp directory
 * of fake CLI executables (`#!/bin/sh` scripts emitting the recorded output
 * formats the v1 quarry verified) — never a real model CLI. An adapter
 * whose CLI is absent must surface a typed AdapterUnavailableError listing
 * what was probed — never a stubbed result.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostSchema } from '@kernloop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADAPTER_NAMES, type AdapterName } from './definitions.js';
import {
  AdapterExecutionError,
  AdapterOutputError,
  AdapterRequestError,
  AdapterTimeoutError,
  AdapterUnavailableError,
  AgenticRepositoryWorkspaceError,
} from './errors.js';
import { detectAdapter, invokeAdapter, type AdapterInvocation } from './invoke.js';

/** POSIX-shell single-quote a string. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Write a fake CLI: a real `#!/bin/sh` executable emitting `lines`. */
function writeFakeCli(
  dir: string,
  name: string,
  lines: readonly string[],
  options: { exitCode?: number; stderr?: string } = {},
): void {
  const body = lines.map((line) => `printf '%s\\n' ${shQuote(line)}`).join('\n');
  const stderr =
    options.stderr === undefined ? '' : `printf '%s\\n' ${shQuote(options.stderr)} >&2\n`;
  const script = `#!/bin/sh\n${body}\n${stderr}exit ${String(options.exitCode ?? 0)}\n`;
  writeFileSync(join(dir, name), script, { mode: 0o755 });
}

/** Recorded-format fixture each fake CLI emits (matches v1 evidence). */
const fixtures: Record<AdapterName, readonly string[]> = {
  claude: [
    '{"type":"result","is_error":false,"result":"claude says hi","session_id":"s1",' +
      '"total_cost_usd":0.0015,"usage":{"input_tokens":100,"output_tokens":50}}',
  ],
  codex: [
    '{"type":"thread.started","thread_id":"thr_1"}',
    '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"codex says hi"}}',
    '{"type":"turn.completed","usage":{"input_tokens":200,"output_tokens":100}}',
  ],
  opencode: [
    '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"opencode says hi"}}',
    '{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","cost":0.002,' +
      '"tokens":{"total":101,"input":78,"output":23}}}',
  ],
  ollama: ['ollama says hi'],
  agy: ['agy says hi'],
};

/** Expected metering per adapter, straight from what each CLI reports. */
const expectedMetering: Record<
  AdapterName,
  { tokens: number; usd: number; metered: { tokens: boolean; usd: boolean } }
> = {
  claude: { tokens: 150, usd: 0.0015, metered: { tokens: true, usd: true } },
  codex: { tokens: 300, usd: 0, metered: { tokens: true, usd: false } },
  opencode: { tokens: 101, usd: 0.002, metered: { tokens: true, usd: true } },
  ollama: { tokens: 0, usd: 0, metered: { tokens: false, usd: false } },
  agy: { tokens: 0, usd: 0, metered: { tokens: false, usd: false } },
};

const tempDirs: string[] = [];
let okDir = '';
let emptyDir = '';

/** Create a tracked temp dir. */
function makeDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kernloop-adapters-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/** Invocation pointing PATH at exactly `dir`. */
function invocationFor(dir: string, extra: Partial<AdapterInvocation> = {}): AdapterInvocation {
  return { prompt: 'test prompt', timeoutMs: 10_000, env: { PATH: dir }, ...extra };
}

beforeAll(() => {
  okDir = makeDir('ok');
  for (const name of ADAPTER_NAMES) writeFakeCli(okDir, name, fixtures[name]);
  emptyDir = makeDir('empty');
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('detectAdapter', () => {
  it('resolves an executable from PATH and lists every probed path', () => {
    const probe = detectAdapter('claude', { PATH: `${emptyDir}:${okDir}` });
    expect(probe.available).toBe(true);
    expect(probe.resolvedPath).toBe(join(okDir, 'claude'));
    expect(probe.probedPaths).toEqual([join(emptyDir, 'claude'), join(okDir, 'claude')]);
  });

  it('reports unavailable when nothing on PATH matches', () => {
    const probe = detectAdapter('codex', { PATH: emptyDir });
    expect(probe.available).toBe(false);
    expect(probe.resolvedPath).toBeNull();
    expect(probe.probedPaths).toEqual([join(emptyDir, 'codex')]);
  });

  it('skips a matching file that is not executable', () => {
    const dir = makeDir('noexec');
    writeFileSync(join(dir, 'opencode'), '#!/bin/sh\n', { mode: 0o644 });
    expect(detectAdapter('opencode', { PATH: dir }).available).toBe(false);
  });

  it('defaults to process.env and still returns a coherent probe', () => {
    const probe = detectAdapter('opencode');
    expect(typeof probe.available).toBe('boolean');
    expect(Array.isArray(probe.probedPaths)).toBe(true);
  });
});

describe('invokeAdapter — uniform interface across all five (CLM-0021)', () => {
  for (const name of ADAPTER_NAMES) {
    it(`invokes ${name} and returns output, contracts Cost, metered flags, raw`, async () => {
      const invocation = invocationFor(okDir, name === 'ollama' ? { model: 'llama3.3' } : {});
      const result = await invokeAdapter(name, invocation);
      const expected = expectedMetering[name];

      expect(result.adapter).toBe(name);
      expect(result.output).toBe(`${name} says hi`);
      expect(CostSchema.safeParse(result.cost).success).toBe(true);
      expect(result.cost.tokens).toBe(expected.tokens);
      expect(result.cost.usd).toBe(expected.usd);
      expect(result.cost.wallClockMs).toBeGreaterThan(0);
      expect(result.cost.byAdapter).toEqual({
        [name]: { tokens: expected.tokens, usd: expected.usd },
      });
      expect(result.metered).toEqual(expected.metered);
      expect(result.raw.exitCode).toBe(0);
    });
  }

  it('runs the CLI in the invocation cwd, not the launch dir (#146)', async () => {
    // A fake claude that reports the cwd it actually ran in.
    const ws = realpathSync(makeDir('cwd-ws'));
    const binDir = makeDir('cwd-bin');
    writeFileSync(
      join(binDir, 'claude'),
      '#!/bin/sh\ncat > /dev/null\nprintf \'{"type":"result","is_error":false,"result":"%s",' +
        '"total_cost_usd":0,"usage":{"input_tokens":1,"output_tokens":1}}\\n\' "$(pwd -P)"\n',
      { mode: 0o755 },
    );
    const result = await invokeAdapter('claude', {
      prompt: 'p',
      timeoutMs: 10_000,
      env: { PATH: binDir },
      cwd: ws,
    });
    expect(result.output).toBe(ws); // grounded in the workspace, not process.cwd()
  });

  it('refuses the agentic spawn for the EXACT dir the child would run in — before any spawn (#570)', async () => {
    // The #570 same-dir guarantee: the cwd containment validates IS the cwd the
    // child would receive — one binding, no divergence. A refusal must therefore
    // happen BEFORE any process starts: the fake CLI proves a spawn by writing a
    // marker, and the marker must never appear.
    const binDir = makeDir('contain-bin');
    const marker = join(binDir, 'spawn-happened');
    writeFileSync(join(binDir, 'claude'), `#!/bin/sh\ncat > /dev/null\ntouch ${marker}\n`, {
      mode: 0o755,
    });
    const repo = makeDir('contain-repo');
    mkdirSync(join(repo, '.git'));
    // Disable the throwaway carve-out deterministically: an unresolvable TMPDIR
    // makes the containment fail CLOSED (tmpRoot null ⇒ every git tree refused),
    // so the fixture repo under the real temp dir is refused on every host.
    const oldTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = '/nonexistent-kernloop-tmp-570';
    try {
      const error = await invokeAdapter('claude', invocationFor(binDir, { cwd: repo })).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AgenticRepositoryWorkspaceError);
      // The refused workspace is the SAME dir the spawn would have used as cwd.
      expect((error as AgenticRepositoryWorkspaceError).workspace).toBe(realpathSync(repo));
      expect(existsSync(marker)).toBe(false); // no process ever ran
    } finally {
      if (oldTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmpdir;
    }
  });

  it('reports zero cost as unmetered, never fabricated (CLM-0020)', async () => {
    // ollama reports no usage at all: tokens/usd are 0 AND flagged false.
    const result = await invokeAdapter('ollama', invocationFor(okDir, { model: 'llama3.3' }));
    expect(result.cost.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.metered).toEqual({ tokens: false, usd: false });
    // claude reports both: same Cost shape, flags true.
    const claude = await invokeAdapter('claude', invocationFor(okDir));
    expect(claude.metered).toEqual({ tokens: true, usd: true });
  });
});

describe('invokeAdapter — unavailable CLI (CLM-0021)', () => {
  it('throws AdapterUnavailableError listing what was probed — never a stub', async () => {
    const error = await invokeAdapter('claude', invocationFor(emptyDir)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdapterUnavailableError);
    const unavailable = error as AdapterUnavailableError;
    expect(unavailable.adapter).toBe('claude');
    expect(unavailable.command).toBe('claude');
    expect(unavailable.probedPaths).toEqual([join(emptyDir, 'claude')]);
    expect(unavailable.message).toContain(join(emptyDir, 'claude'));
  });
});

describe('invokeAdapter — typed failures', () => {
  it('throws AdapterExecutionError with exit code and stderr on CLI failure', async () => {
    const dir = makeDir('fail');
    writeFakeCli(dir, 'codex', [], { exitCode: 2, stderr: 'invalid api key' });
    const error = await invokeAdapter('codex', invocationFor(dir)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdapterExecutionError);
    const failure = error as AdapterExecutionError;
    expect(failure.exitCode).toBe(2);
    expect(failure.stderr).toContain('invalid api key');
  });

  it('throws AdapterTimeoutError and kills the CLI on wall-clock breach (CLM-0019)', async () => {
    const dir = makeDir('hang');
    // Builtin-only busy loop: hangs forever without external commands.
    writeFileSync(join(dir, 'opencode'), '#!/bin/sh\nwhile :; do :; done\n', { mode: 0o755 });
    const started = performance.now();
    const error = await invokeAdapter('opencode', invocationFor(dir, { timeoutMs: 150 })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdapterTimeoutError);
    const timeout = error as AdapterTimeoutError;
    expect(timeout.timeoutMs).toBe(150);
    // Monotonic bound only: the call settled instead of hanging forever.
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('throws AdapterOutputError preserving raw output when stdout is unusable', async () => {
    const dir = makeDir('garbage');
    writeFakeCli(dir, 'claude', ['this is not the recorded claude JSON format']);
    const error = await invokeAdapter('claude', invocationFor(dir)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdapterOutputError);
    expect((error as AdapterOutputError).stdout).toContain('not the recorded claude JSON');
  });

  it('throws AdapterRequestError when ollama is invoked without a model', async () => {
    await expect(invokeAdapter('ollama', invocationFor(okDir))).rejects.toBeInstanceOf(
      AdapterRequestError,
    );
    await expect(invokeAdapter('ollama', invocationFor(okDir, { model: '' }))).rejects.toThrow(
      /requires an explicit model/,
    );
  });

  it('throws AdapterRequestError for a non-positive timeout', async () => {
    await expect(invokeAdapter('claude', invocationFor(okDir, { timeoutMs: 0 }))).rejects.toThrow(
      /timeoutMs must be a positive finite number/,
    );
  });
});
