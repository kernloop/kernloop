import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSymbol } from './symbols.js';

/** Materialize one source file in a temp dir and return its absolute path. */
function fileWith(source: string, name = 'mod.ts'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-symbols-'));
  const full = path.join(dir, name);
  fs.writeFileSync(full, source);
  return full;
}

const SOURCE = [
  '/** Frames the goal into a refined TaskContract. */',
  'export function frameGoal(goal: string): string {',
  '  return goal.trim();',
  '}',
  '',
  '/** The canonical neutral fitness prior. */',
  'export const NEUTRAL_PRIOR = 0.5;',
  '',
  'export const NO_DOC_CONST = 1;',
  '',
  '/** A capability router. */',
  'export class Router {',
  '  /** Routes one TaskContract to a manifest. */',
  '  route(): number {',
  '    return 1;',
  '  }',
  '}',
  '',
  '/** A stored trace summary shape. */',
  'export interface TraceSummary {',
  '  taskId: string;',
  '}',
  '',
  '// a plain line comment, not JSDoc',
  'export const LINE_COMMENTED = 4;',
  '',
].join('\n');

describe('findSymbol — single-file symbol resolution', () => {
  it('resolves an exported function and extracts its doc-comment', () => {
    const result = findSymbol(fileWith(SOURCE), 'frameGoal');
    expect(result.found).toBe(true);
    expect(result.kind).toBe('FunctionDeclaration');
    expect(result.doc).toContain('Frames the goal');
  });

  it('resolves an exported const and lifts the JSDoc from its statement', () => {
    const result = findSymbol(fileWith(SOURCE), 'NEUTRAL_PRIOR');
    expect(result.found).toBe(true);
    expect(result.kind).toBe('VariableDeclaration');
    expect(result.doc).toContain('neutral fitness prior');
  });

  it('resolves a class method via a dotted path and reads its doc', () => {
    const result = findSymbol(fileWith(SOURCE), 'Router.route');
    expect(result.found).toBe(true);
    expect(result.kind).toBe('MethodDeclaration');
    expect(result.doc).toContain('Routes one TaskContract');
  });

  it('resolves an interface declaration', () => {
    const result = findSymbol(fileWith(SOURCE), 'TraceSummary');
    expect(result.found).toBe(true);
    expect(result.kind).toBe('InterfaceDeclaration');
    expect(result.doc).toContain('trace summary');
  });

  it('reports found with no doc when the symbol carries no comment', () => {
    const result = findSymbol(fileWith(SOURCE), 'NO_DOC_CONST');
    expect(result.found).toBe(true);
    expect(result.doc).toBeUndefined();
  });

  it('falls back to a leading line comment when there is no JSDoc', () => {
    const result = findSymbol(fileWith(SOURCE), 'LINE_COMMENTED');
    expect(result.found).toBe(true);
    expect(result.doc).toContain('plain line comment');
  });

  it('returns a precise reason when the symbol is absent', () => {
    const result = findSymbol(fileWith(SOURCE), 'missingSymbol');
    expect(result.found).toBe(false);
    expect(result.reason).toContain('no declared symbol "missingSymbol"');
  });

  it('returns a precise reason when a nested member is absent', () => {
    const result = findSymbol(fileWith(SOURCE), 'Router.nope');
    expect(result.found).toBe(false);
    expect(result.reason).toContain('no declared symbol "nope" in "Router"');
  });

  it('returns not-found for a missing file', () => {
    const result = findSymbol('/no/such/file.ts', 'whatever');
    expect(result.found).toBe(false);
    expect(result.reason).toContain('file not found');
  });

  it('rejects an empty symbol path', () => {
    const result = findSymbol(fileWith(SOURCE), '');
    expect(result.found).toBe(false);
    expect(result.reason).toContain('empty symbol path');
  });
});
