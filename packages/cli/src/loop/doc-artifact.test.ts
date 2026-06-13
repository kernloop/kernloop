import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOC_ARTIFACT_NAME, renderApiDoc, writeDocArtifact } from './doc-artifact.js';
import type { MinedFile } from '@kernloop/faculty-gates';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'doc-artifact-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('renderApiDoc', () => {
  const mined: MinedFile[] = [
    {
      file: 'src/auth.ts',
      symbols: [
        { name: 'login', kind: 'FunctionDeclaration', doc: 'Authenticate a user.', line: 2 },
        { name: 'logout', kind: 'FunctionDeclaration', doc: null, line: 8 },
      ],
    },
  ];

  it('renders documented symbols with their doc and marks undocumented ones', () => {
    const md = renderApiDoc(mined);
    expect(md).toContain('## src/auth.ts');
    expect(md).toContain('`login` (function) — Authenticate a user.');
    expect(md).toContain('`logout` (function) — **UNDOCUMENTED**');
    expect(md).toContain('generated from doc-comments');
  });

  it('is deterministic — same input, identical bytes', () => {
    expect(renderApiDoc(mined)).toBe(renderApiDoc(mined));
  });

  it('sorts files by path so output is byte-stable regardless of walk order', () => {
    const z: MinedFile = {
      file: 'z.ts',
      symbols: [{ name: 'z', kind: 'FunctionDeclaration', doc: 'Z.', line: 1 }],
    };
    const a: MinedFile = {
      file: 'a.ts',
      symbols: [{ name: 'a', kind: 'FunctionDeclaration', doc: 'A.', line: 1 }],
    };
    // Same files, opposite input order → identical output (a.ts before z.ts).
    expect(renderApiDoc([z, a])).toBe(renderApiDoc([a, z]));
    expect(renderApiDoc([z, a]).indexOf('## a.ts')).toBeLessThan(
      renderApiDoc([z, a]).indexOf('## z.ts'),
    );
  });

  it('never invents prose — only the doc-comment text appears', () => {
    const md = renderApiDoc([
      { file: 'a.ts', symbols: [{ name: 'f', kind: 'FunctionDeclaration', doc: 'X.', line: 1 }] },
    ]);
    // The summary is exactly the doc text, collapsed — no model narrative.
    expect(md).toContain('`f` (function) — X.');
  });
});

describe('writeDocArtifact', () => {
  it('writes API.generated.md from the deliverable and returns counts', () => {
    write('src/a.ts', '/** Adds. */\nexport function add() {}\nexport const k = 1;\n');
    const result = writeDocArtifact(dir);
    expect(result.written).toBe(true);
    expect(result.path).toBe(DOC_ARTIFACT_NAME);
    expect(result.symbolCount).toBe(2);
    expect(result.documentedCount).toBe(1);
    const md = readFileSync(path.join(dir, DOC_ARTIFACT_NAME), 'utf8');
    expect(md).toContain('`add` (function) — Adds.');
    expect(md).toContain('`k` (variable) — **UNDOCUMENTED**');
  });

  it('writes NOTHING when the deliverable exposes no TS/JS symbols', () => {
    write('README.md', '# hi\n');
    write('lib.py', 'def f():\n    pass\n');
    const result = writeDocArtifact(dir);
    expect(result.written).toBe(false);
    expect(result.symbolCount).toBe(0);
    expect(existsSync(path.join(dir, DOC_ARTIFACT_NAME))).toBe(false);
  });
});
