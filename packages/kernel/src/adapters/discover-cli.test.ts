/**
 * CLI-agent model discovery (#131, CLM-0131): discoverCliModels spawns an
 * adapter's FIXED list command under a bounded subprocess and parses stdout as
 * DATA ONLY. Covers: the opencode list parse (trim/dedup/drop-blank/length-bound),
 * the honest empty for a harness-routed CLI with no list, and the typed failures
 * (nonzero exit, timeout, spawn error) — never a fabricated list.
 */
import { describe, expect, it } from 'vitest';
import { AdapterExecutionError, AdapterTimeoutError } from './errors.js';
import { discoverCliModels, CLI_DISCOVERY_ADAPTERS } from './discover.js';
import type { SubprocessResult, SubprocessSpec } from './subprocess.js';

function result(over: Partial<SubprocessResult> = {}): SubprocessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    durationMs: 5,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...over,
  };
}

/** A scripted runner that records the spec it was given. */
function scripted(res: SubprocessResult): {
  run: (spec: SubprocessSpec) => Promise<SubprocessResult>;
  calls: SubprocessSpec[];
} {
  const calls: SubprocessSpec[] = [];
  return {
    calls,
    run: (spec) => {
      calls.push(spec);
      return Promise.resolve(res);
    },
  };
}

describe('discoverCliModels (#131)', () => {
  it('spawns the FIXED `<adapter> models` argv (no shell) and parses one id per line', async () => {
    const { run, calls } = scripted(
      result({ stdout: 'opencode/big-pickle\nopencode/mimo-v2.5-free\n' }),
    );
    const ids = await discoverCliModels('opencode', run);
    expect(ids).toEqual(['opencode/big-pickle', 'opencode/mimo-v2.5-free']);
    expect(calls[0]?.command).toBe('opencode');
    expect(calls[0]?.args).toEqual(['models']);
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
    expect(calls[0]?.maxCaptureBytes).toBeGreaterThan(0);
  });

  it('trims, drops blanks, de-duplicates, and bounds line length (output is data)', async () => {
    const longId = 'x'.repeat(300); // > 256 → dropped
    const { run } = scripted(
      result({ stdout: `  opencode/a  \nopencode/b\n\nopencode/a\n${longId}\n` }),
    );
    expect(await discoverCliModels('opencode', run)).toEqual(['opencode/a', 'opencode/b']);
  });

  it('scopes the child env — the host secrets never reach the third-party CLI (#131)', async () => {
    const planted = process.env.GH_TOKEN;
    process.env.GH_TOKEN = 'super-secret-token';
    try {
      const { run, calls } = scripted(result({ stdout: 'opencode/a\n' }));
      await discoverCliModels('opencode', run);
      const env = calls[0]?.env ?? {};
      expect(env.GH_TOKEN).toBeUndefined(); // dropped — not the host process.env
      expect('PATH' in env).toBe(true); // benign operational var survives
    } finally {
      if (planted === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = planted;
    }
  });

  it('honors envAllow — a named extra var is passed through to the CLI (#131)', async () => {
    const planted = process.env.OPENCODE_API_KEY;
    process.env.OPENCODE_API_KEY = 'key-value';
    try {
      const { run, calls } = scripted(result({ stdout: 'opencode/a\n' }));
      await discoverCliModels('opencode', run, ['OPENCODE_API_KEY']);
      expect(calls[0]?.env?.OPENCODE_API_KEY).toBe('key-value');
    } finally {
      if (planted === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = planted;
    }
  });

  it('returns [] for a harness-routed CLI with no list command (honest, no spawn)', async () => {
    const { run, calls } = scripted(result({ stdout: 'should not be read' }));
    expect(await discoverCliModels('claude', run)).toEqual([]);
    expect(calls).toHaveLength(0); // never spawned
    expect(CLI_DISCOVERY_ADAPTERS).not.toContain('claude');
    expect(CLI_DISCOVERY_ADAPTERS).toContain('opencode');
  });

  it('a nonzero exit is a typed AdapterExecutionError, never a guessed list', async () => {
    const { run } = scripted(result({ exitCode: 1, stderr: 'boom' }));
    await expect(discoverCliModels('opencode', run)).rejects.toBeInstanceOf(AdapterExecutionError);
  });

  it('a timeout is a typed AdapterTimeoutError', async () => {
    const { run } = scripted(result({ timedOut: true, exitCode: null, signal: 'SIGKILL' }));
    await expect(discoverCliModels('opencode', run)).rejects.toBeInstanceOf(AdapterTimeoutError);
  });

  it('a spawn failure (absent CLI) is a typed AdapterExecutionError', async () => {
    const run = (): Promise<SubprocessResult> => Promise.reject(new Error('spawn opencode ENOENT'));
    await expect(discoverCliModels('opencode', run)).rejects.toBeInstanceOf(AdapterExecutionError);
  });
});
