/**
 * Test fixture builder: materializes a throwaway repo in a temp dir so the
 * deliberate-failure proofs run against real files, not mocks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const createdRoots: string[] = [];

/** Write a map of relative-path → content into a fresh temp repo root. */
export function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-claims-'));
  createdRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** Remove every temp repo created by makeRepo (call from afterAll). */
export function cleanupRepos(): void {
  for (const root of createdRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Serialize a claim object (or any overrides of the base claim) to YAML. */
export function claimYaml(overrides: Record<string, unknown> = {}): string {
  return YAML.stringify({
    id: 'CLM-0001',
    statement: 'The fixture capability is proven by a real test.',
    evidence: ['test:src/cap.test.ts::proves the capability'],
    status: 'verified',
    owner: 'williamzujkowski',
    since: '0.1.0',
    ...overrides,
  });
}

/** A vitest file containing the test the base claim references. */
export const CAP_TEST_FILE = [
  "import { expect, it } from 'vitest';",
  "it('proves the capability', () => { expect(true).toBe(true); });",
  '',
].join('\n');

/** A workflow with job key `test` and display name `unit tests`. */
export const WORKFLOW_FILE = [
  'name: CI',
  'on: push',
  'jobs:',
  '  test:',
  '    name: unit tests',
  '    runs-on: ubuntu-latest',
  '    steps: []',
  '',
].join('\n');

/** A doc with a sluggable heading and an explicit <a id> anchor. */
export const DOC_FILE = [
  '# Fixture Doc',
  '',
  '## Evidence & Anchors',
  '',
  '<a id="explicit-anchor"></a>',
  'Anchored text.',
  '',
].join('\n');
