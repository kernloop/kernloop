/**
 * Unit tests for the loop's model seam: strict JSON extraction (the model
 * output contracts never coerce), metered invoke accumulation, adapter
 * availability as a typed error, and the path-traversal guard on the
 * coder's emitted files [CLM-0046 support].
 */
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('throws on an unterminated object and on invalid JSON between balanced braces', () => {
    expect(() => extractJsonObject('{"open": "forever', 'files')).toThrow('unterminated');
    expect(() => extractJsonObject('{bad}', 'files')).toThrow('invalid JSON');
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
    const before = readdirSync(scratch).length;
    expect(() =>
      writeWorkspaceFiles(workspace, [{ path: path.join(scratch, 'abs.ts'), content: 'evil' }]),
    ).toThrow('escapes the workspace');
    expect(readdirSync(scratch)).toHaveLength(before);
  });
});
