import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTestCall, resolveEvidence } from './resolve.js';
import { parseEvidenceRef } from './schema.js';

describe('findTestCall — static test-shape inspection', () => {
  it('finds a live test and reports a non-empty body', () => {
    const call = findTestCall("it('does a thing', () => { expect(1).toBe(1); });", 'does a thing');
    expect(call).toEqual({ token: 'it', modifiers: '', emptyBody: false });
  });

  it('reports an empty body (no assertions)', () => {
    expect(findTestCall("test('hollow', () => {})", 'hollow')?.emptyBody).toBe(true);
  });

  it('treats a comment-only body as empty', () => {
    expect(findTestCall("it('todo', () => { /* later */ })", 'todo')?.emptyBody).toBe(true);
  });

  it('captures a .skip modifier', () => {
    expect(
      findTestCall("it.skip('parked', () => { expect(1).toBe(1); })", 'parked')?.modifiers,
    ).toBe('.skip');
  });

  it('captures the xit token', () => {
    expect(findTestCall("xit('off', () => { expect(1).toBe(1); })", 'off')?.token).toBe('xit');
  });

  it('matches a parameterized it.each by its template name', () => {
    const call = findTestCall(
      "it.each([1,2])('seed %i: holds', () => { expect(1).toBe(1); })",
      'seed %i: holds',
    );
    expect(call?.emptyBody).toBe(false);
    expect(call?.modifiers).toContain('.each');
  });

  it('returns null when the named test is absent', () => {
    expect(findTestCall("it('other', () => {})", 'missing')).toBeNull();
  });

  it('detects an empty function() body without bleeding into a later arrow test', () => {
    const src = "it('a', function () {});\nit('b', () => { expect(1).toBe(1); });";
    expect(findTestCall(src, 'a')?.emptyBody).toBe(true);
    expect(findTestCall(src, 'b')?.emptyBody).toBe(false);
  });
});

describe('resolveEvidence — disabled and empty tests are not evidence', () => {
  function repoWith(testSource: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-resolve-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'x.test.ts'), testSource);
    return root;
  }
  function check(root: string, name: string): string | null {
    const ref = parseEvidenceRef(`test:src/x.test.ts::${name}`);
    if ('error' in ref) throw new Error(ref.error);
    return resolveEvidence(ref, root);
  }

  it('resolves a live, non-empty test', () => {
    expect(check(repoWith("it('real', () => { expect(1).toBe(1); })"), 'real')).toBeNull();
  });

  it('rejects a skipped test', () => {
    expect(check(repoWith("it.skip('real', () => { expect(1).toBe(1); })"), 'real')).toContain(
      'disabled',
    );
  });

  it('rejects an it.only test', () => {
    expect(check(repoWith("it.only('real', () => { expect(1).toBe(1); })"), 'real')).toContain(
      'disabled',
    );
  });

  it('rejects an empty-bodied test', () => {
    expect(check(repoWith("it('real', () => {})"), 'real')).toContain('empty body');
  });

  it('rejects a missing test', () => {
    expect(check(repoWith("it('other', () => {})"), 'real')).toContain('no test named');
  });
});

describe('resolveEvidence — code: anchors a symbol and (optionally) its doc', () => {
  const SRC = [
    '/** Records an Outcome as a trace summary (code-anchor doc). */',
    'export function recordOutcome(): number {',
    '  return 1;',
    '}',
    '',
    '/** A const with no asserting words. */',
    'export const PLAIN = 2;',
    '',
    'export const UNDOCUMENTED = 3;',
    '',
  ].join('\n');

  function repoWith(source: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-code-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'mod.ts'), source);
    return root;
  }
  function check(root: string, ref: string): string | null {
    const parsed = parseEvidenceRef(ref);
    if ('error' in parsed) throw new Error(parsed.error);
    return resolveEvidence(parsed, root);
  }

  it('resolves when the symbol exists (no @doc)', () => {
    expect(check(repoWith(SRC), 'code:src/mod.ts#recordOutcome')).toBeNull();
  });

  it('reports a precise error when the symbol is missing', () => {
    const msg = check(repoWith(SRC), 'code:src/mod.ts#noSuchSymbol');
    expect(msg).toContain('no exported/declared symbol "noSuchSymbol"');
  });

  it('resolves when the @doc regex matches the doc-comment', () => {
    expect(check(repoWith(SRC), 'code:src/mod.ts#recordOutcome@doc:/trace summary/')).toBeNull();
  });

  it('fails when the @doc regex does not match the doc-comment', () => {
    const msg = check(repoWith(SRC), 'code:src/mod.ts#PLAIN@doc:/asserts the claim/');
    expect(msg).toContain('does not match');
  });

  it('fails when @doc is required but the symbol has no doc-comment', () => {
    const msg = check(repoWith(SRC), 'code:src/mod.ts#UNDOCUMENTED@doc:/anything/');
    expect(msg).toContain('no doc-comment');
  });

  it('fails when the anchored file does not exist', () => {
    expect(check(repoWith(SRC), 'code:src/gone.ts#recordOutcome')).toContain('file not found');
  });
});
