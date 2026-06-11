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
