/**
 * Unit tests for the loop's model seam: strict JSON extraction (the model
 * output contracts never coerce), metered invoke accumulation, adapter
 * availability as a typed error, and the path-traversal guard on the
 * coder's emitted files [CLM-0046 support].
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AdapterUnavailableError } from '@kernloop/kernel';
import {
  BallotEmissionSchema,
  FilesEmissionSchema,
  LoopParseError,
  LoopResumeError,
  SubtasksEmissionSchema,
  ensureAdapterAvailable,
  extractJsonObject,
  meteredInvoke,
  parseEmission,
  persistViolation,
  type LoopInvoke,
} from './invoke.js';
import { writeWorkspaceFiles } from './executors.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-unit-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('extractJsonObject', () => {
  it('extracts the first balanced JSON object out of surrounding prose and fences', () => {
    const raw =
      'Sure! Here is my ballot:\n```json\n{"vote":"approve","reasoning":"ok"}\n```\nDone.';
    expect(extractJsonObject(raw, 'ballot')).toEqual({ vote: 'approve', reasoning: 'ok' });
  });

  it('balances braces inside JSON strings (a "}" in a string does not close the object)', () => {
    const raw = 'x {"reasoning":"uses {braces} and a \\" quote","vote":"reject"} y';
    expect(extractJsonObject(raw, 'ballot')).toEqual({
      reasoning: 'uses {braces} and a " quote',
      vote: 'reject',
    });
  });

  it('throws the typed parse error when no JSON object is present', () => {
    expect(() => extractJsonObject('no json here', 'subtasks')).toThrowError(LoopParseError);
    expect(() => extractJsonObject('no json here', 'subtasks')).toThrow('subtasks');
  });

  it('throws on an unterminated object, and reports "no parsable object" when the only braces are non-JSON', () => {
    expect(() => extractJsonObject('{"open": "forever', 'files')).toThrow('unterminated');
    expect(() => extractJsonObject('{bad}', 'files')).toThrow('no parsable JSON object');
  });

  it('STEPS OVER a balanced-but-non-JSON prose snippet and returns the real object after it (#130)', () => {
    // An agentic-CLI shape: narration with a brace-bearing code snippet, THEN the
    // real contract JSON. The snippet `{ return x }` is not valid JSON and must
    // be skipped, not parsed (the old "first balanced object" choked on it).
    const raw =
      'Edit/Write are denied. Let me produce the files. cli.ts widens flags() { return x } then:\n' +
      '{"files":[{"path":"a.ts","content":"x"}]}';
    expect(extractJsonObject(raw, 'files')).toEqual({
      files: [{ path: 'a.ts', content: 'x' }],
    });
  });

  it('parses the WHOLE trimmed output first: TS file content with braces and escaped quotes', () => {
    const content = 'export function f(): string {\n  return "{\\"nested\\": true}";\n}\n';
    const raw = `\n${JSON.stringify({ files: [{ path: 'src/f.ts', content }], notes: '' })}\n`;
    expect(extractJsonObject(raw, 'files')).toEqual({
      files: [{ path: 'src/f.ts', content }],
      notes: '',
    });
  });

  it('prefers the fenced block when prose around it carries braces and quotes (live-failure shape)', () => {
    const raw =
      'I wrote `greet() { return "hi"; }` as asked.\n' +
      '```json\n{"vote":"approve","reasoning":"ok"}\n```\nDone.';
    expect(extractJsonObject(raw, 'ballot')).toEqual({ vote: 'approve', reasoning: 'ok' });
  });

  it('falls back to the raw scan when the fenced block carries no object', () => {
    const raw = '```\nplain text, no object\n```\n{"vote":"reject","reasoning":"no"}';
    expect(extractJsonObject(raw, 'ballot')).toEqual({ vote: 'reject', reasoning: 'no' });
  });

  it('still fails honestly on truncated JSON inside an unterminated fence', () => {
    const raw = '```json\n{"files":[{"path":"a.ts","content":"cut off mid-str';
    expect(() => extractJsonObject(raw, 'files')).toThrow('unterminated');
  });
});

describe('parseEmission (the strict output contracts)', () => {
  it('rejects a ballot with a vote outside approve/reject/abstain', () => {
    const raw = '{"vote":"maybe","reasoning":"…"}';
    expect(() => parseEmission(raw, BallotEmissionSchema, 'ballot')).toThrowError(LoopParseError);
  });

  it('rejects an empty subtasks array and a files emission with an empty path', () => {
    expect(() => parseEmission('{"subtasks":[]}', SubtasksEmissionSchema, 'subtasks')).toThrow(
      'subtasks',
    );
    expect(() =>
      parseEmission('{"files":[{"path":"","content":"x"}]}', FilesEmissionSchema, 'files'),
    ).toThrowError(LoopParseError);
  });

  it('defaults the coder notes to an empty string', () => {
    const parsed = parseEmission(
      '{"files":[{"path":"a.ts","content":"x"}]}',
      FilesEmissionSchema,
      'files',
    );
    expect(parsed.notes).toBe('');
  });
});

describe('parseEmission violation capture (diagnosability, no retry)', () => {
  it('persists the raw output under <overlay>/checkpoints and names the path in the error', () => {
    const overlayDir = path.join(scratch, 'overlay-violation');
    const raw = 'Sure! Here you go: {"files":[],"notes":"nothing to write"}';
    const sink = { overlayDir, runId: 'run-9', node: 'implement-task.1' };
    let caught: unknown;
    try {
      // The empty files array stays a violation — validation is unweakened.
      parseEmission(raw, FilesEmissionSchema, 'files', sink);
    } catch (error) {
      caught = error;
    }
    const file = path.join(overlayDir, 'checkpoints', 'run-9-implement-task.1-violation.txt');
    expect(caught).toBeInstanceOf(LoopParseError);
    expect((caught as LoopParseError).message).toContain('>=1');
    expect((caught as LoopParseError).message).toContain(file);
    expect(readFileSync(file, 'utf8')).toBe(raw);
  });

  it('sanitizes unsafe characters out of the violation file name', () => {
    const overlayDir = path.join(scratch, 'overlay-sanitize');
    expect(persistViolation({ overlayDir, runId: 'run/x', node: 'vote architect' }, 'raw')).toBe(
      path.join(overlayDir, 'checkpoints', 'run_x-vote_architect-violation.txt'),
    );
  });

  it('writes nothing when the emission satisfies its contract', () => {
    const overlayDir = path.join(scratch, 'overlay-clean');
    const sink = { overlayDir, runId: 'run-ok', node: 'implement-x' };
    const parsed = parseEmission(
      '{"files":[{"path":"a.ts","content":"x"}]}',
      FilesEmissionSchema,
      'files',
      sink,
    );
    expect(parsed.files).toHaveLength(1);
    expect(existsSync(path.join(overlayDir, 'checkpoints'))).toBe(false);
  });
});

describe('meteredInvoke', () => {
  it('accumulates every call’s metered tokens and usd into the totals', async () => {
    const base: LoopInvoke = () =>
      Promise.resolve({ output: 'ok', cost: { tokens: 5, usd: 0.25 } });
    const totals = { tokens: 0, usd: 0 };
    const invoke = meteredInvoke(base, totals);
    await invoke('one');
    await invoke('two');
    expect(totals).toEqual({ tokens: 10, usd: 0.5 });
  });

  it('attributes spend to the named adapter in byAdapter, summing per adapter (#44)', async () => {
    const base: LoopInvoke = () => Promise.resolve({ output: 'ok', cost: { tokens: 4, usd: 0.1 } });
    const totals: { tokens: number; usd: number; byAdapter?: Record<string, unknown> } = {
      tokens: 0,
      usd: 0,
    };
    await meteredInvoke(base, totals, 'claude')('a');
    await meteredInvoke(base, totals, 'claude')('b');
    await meteredInvoke(base, totals, 'codex')('c');
    expect(totals.tokens).toBe(12); // flat total still summed
    expect(totals.byAdapter).toEqual({
      claude: { tokens: 8, usd: 0.2 },
      codex: { tokens: 4, usd: 0.1 },
    });
  });

  it('leaves byAdapter unset when no adapter is named (backward-compat)', async () => {
    const base: LoopInvoke = () =>
      Promise.resolve({ output: 'ok', cost: { tokens: 3, usd: 0.05 } });
    const totals: { tokens: number; usd: number; byAdapter?: unknown } = { tokens: 0, usd: 0 };
    await meteredInvoke(base, totals)('x');
    expect(totals.byAdapter).toBeUndefined();
  });
});

describe('ensureAdapterAvailable', () => {
  it('throws the kernel’s typed unavailability error when the CLI is not on PATH', () => {
    expect(() => ensureAdapterAvailable('claude', { PATH: scratch })).toThrowError(
      AdapterUnavailableError,
    );
  });

  it('passes when the adapter executable is found on PATH', () => {
    const fake = path.join(scratch, 'claude');
    writeFileSync(fake, '#!/bin/sh\nexit 0\n');
    chmodSync(fake, 0o755);
    expect(() => ensureAdapterAvailable('claude', { PATH: scratch })).not.toThrow();
  });
});

describe('LoopResumeError', () => {
  it('names the run id and the checkpoint file it looked for', () => {
    const error = new LoopResumeError('run-1', '/x/checkpoints/run-1.jsonl');
    expect(error.code).toBe('no_checkpoint');
    expect(error.message).toContain('run-1');
    expect(error.message).toContain('/x/checkpoints/run-1.jsonl');
  });
});

describe('writeWorkspaceFiles (path-traversal guard)', () => {
  it('writes nested files inside the workspace and returns workspace-relative paths', () => {
    const workspace = path.join(scratch, 'ws-ok');
    const written = writeWorkspaceFiles(workspace, [
      { path: 'src/deep/feature.ts', content: 'export const x = 1;\n' },
    ]);
    expect(written).toEqual([path.join('src', 'deep', 'feature.ts')]);
    expect(existsSync(path.join(workspace, 'src', 'deep', 'feature.ts'))).toBe(true);
  });

  it('rejects a path escaping the workspace and writes NOTHING (checked before the first write)', () => {
    const workspace = path.join(scratch, 'ws-guard');
    expect(() =>
      writeWorkspaceFiles(workspace, [
        { path: 'inside.ts', content: 'ok' },
        { path: '../escape.ts', content: 'evil' },
      ]),
    ).toThrowError(LoopParseError);
    expect(existsSync(path.join(workspace, 'inside.ts'))).toBe(false);
    expect(existsSync(path.join(scratch, 'escape.ts'))).toBe(false);
  });

  it('rejects an absolute path outside the workspace', () => {
    const workspace = path.join(scratch, 'ws-abs');
    mkdirSync(workspace, { recursive: true });
    const before = readdirSync(workspace).length;
    expect(() =>
      writeWorkspaceFiles(workspace, [{ path: path.join(scratch, 'abs.ts'), content: 'evil' }]),
    ).toThrow('escapes the workspace');
    expect(existsSync(path.join(scratch, 'abs.ts'))).toBe(false);
    expect(readdirSync(workspace)).toHaveLength(before);
  });

  it('rejects a write through a pre-existing symlink that escapes the workspace', () => {
    const workspace = path.join(scratch, 'ws-symlink');
    const outside = path.join(scratch, 'outside-target');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    // An innocent-looking symlink already in the workspace points outside it.
    symlinkSync(outside, path.join(workspace, 'link'));
    expect(() =>
      writeWorkspaceFiles(workspace, [{ path: 'link/pwned.ts', content: 'escaped' }]),
    ).toThrow('symlink');
    expect(existsSync(path.join(outside, 'pwned.ts'))).toBe(false);
  });

  it('refuses to write THROUGH a symlinked target file (the leaf, O_NOFOLLOW) (#161)', () => {
    const workspace = path.join(scratch, 'ws-leaf');
    mkdirSync(workspace, { recursive: true });
    const secret = path.join(scratch, 'secret.txt');
    writeFileSync(secret, 'ORIGINAL\n', 'utf8');
    // The target file itself is a symlink out of the workspace — the parent dir
    // is clean, so only a leaf check (O_NOFOLLOW) can stop the escape.
    symlinkSync(secret, path.join(workspace, 'config'));
    expect(() => writeWorkspaceFiles(workspace, [{ path: 'config', content: 'PWNED' }])).toThrow(
      'symlink',
    );
    expect(readFileSync(secret, 'utf8')).toBe('ORIGINAL\n'); // the outside file is untouched
  });

  it('still writes when the workspace itself is under a symlink (realpath root)', () => {
    const realWorkspace = path.join(scratch, 'ws-real');
    const linkedWorkspace = path.join(scratch, 'ws-link');
    mkdirSync(realWorkspace, { recursive: true });
    symlinkSync(realWorkspace, linkedWorkspace);
    const written = writeWorkspaceFiles(linkedWorkspace, [{ path: 'a.ts', content: 'ok\n' }]);
    expect(written).toEqual(['a.ts']);
    expect(existsSync(path.join(realWorkspace, 'a.ts'))).toBe(true);
  });
});
