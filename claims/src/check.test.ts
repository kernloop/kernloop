/**
 * Deliberate-failure proofs for claims:check: each failure class the gate
 * promises to catch is reproduced against a real fixture repo and shown to
 * turn the gate red. CLM-0007 and CLM-0008 cite these tests as evidence.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cli, runClaimsCheck, summaryTable } from './check.js';
import {
  CAP_TEST_FILE,
  DOC_FILE,
  WORKFLOW_FILE,
  claimYaml,
  cleanupRepos,
  makeRepo,
} from './__fixtures__/fixture-repo.js';

afterAll(cleanupRepos);

function repoWith(registry: Record<string, string>, extra: Record<string, string> = {}): string {
  const files: Record<string, string> = {
    'src/cap.test.ts': CAP_TEST_FILE,
    '.github/workflows/ci.yml': WORKFLOW_FILE,
    'docs/fixture.md': DOC_FILE,
    'evals/review-set.json': '[]',
    ...extra,
  };
  for (const [name, content] of Object.entries(registry)) {
    files[`claims/registry/${name}`] = content;
  }
  return makeRepo(files);
}

describe('runClaimsCheck — happy path', () => {
  it('passes a registry whose evidence all resolves', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: [
          'test:src/cap.test.ts::proves the capability',
          'ci:test',
          'doc:docs/fixture.md#evidence--anchors',
          'doc:docs/fixture.md#explicit-anchor',
          'eval:evals/review-set.json',
        ],
      }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(summaryTable(result.claims)).toContain('CLM-0001');
    expect(summaryTable(result.claims)).toContain('5 evidence');
  });

  it('resolves a ci ref by job display name', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: ['test:src/cap.test.ts::proves the capability', 'ci:unit tests'],
      }),
    });
    expect(runClaimsCheck({ repoRoot: root }).ok).toBe(true);
  });

  it('passes an experimental claim that has zero test evidence', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({ status: 'experimental', evidence: ['ci:test'] }),
    });
    expect(runClaimsCheck({ repoRoot: root }).ok).toBe(true);
  });
});

describe('runClaimsCheck — dangling evidence (CLM-0007 proofs)', () => {
  it('fails a claim whose test ref names a nonexistent test', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({ evidence: ['test:src/cap.test.ts::a test that is not there'] }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('no test named "a test that is not there"');
  });

  it('fails a claim whose test ref points at a missing file', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({ evidence: ['test:src/gone.test.ts::proves the capability'] }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('test file not found: src/gone.test.ts');
  });

  it('fails a test ref whose name only appears as a template literal', () => {
    const root = repoWith(
      { 'CLM-0001.yaml': claimYaml({ evidence: ['test:src/tpl.test.ts::templated name'] }) },
      { 'src/tpl.test.ts': 'it(`templated name`, () => {});\n' },
    );
    expect(runClaimsCheck({ repoRoot: root }).ok).toBe(false);
  });

  it('fails a claim whose ci ref names a nonexistent job', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: ['test:src/cap.test.ts::proves the capability', 'ci:deploy'],
      }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('no CI job named "deploy"');
  });

  it('fails a claim whose doc anchor is missing', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: ['test:src/cap.test.ts::proves the capability', 'doc:docs/fixture.md#nope'],
      }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('anchor "#nope" not found');
  });

  it('fails a claim whose doc ref points at a missing file', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: ['test:src/cap.test.ts::proves the capability', 'doc:docs/gone.md#x'],
      }),
    });
    expect(runClaimsCheck({ repoRoot: root }).ok).toBe(false);
  });

  it('fails a claim whose eval artifact does not exist', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml({
        evidence: ['test:src/cap.test.ts::proves the capability', 'eval:evals/gone.json'],
      }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('eval artifact not found: evals/gone.json');
  });
});

describe('runClaimsCheck — registry structure', () => {
  it('fails a verified claim that has zero test evidence', () => {
    const root = repoWith({ 'CLM-0001.yaml': claimYaml({ evidence: ['ci:test'] }) });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('"verified" but the claim has zero test evidence');
  });

  it('fails on duplicate claim ids', () => {
    const root = repoWith({
      'CLM-0001.yaml': claimYaml(),
      'CLM-0002.yaml': claimYaml({ id: 'CLM-0001' }),
    });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('duplicate claim id CLM-0001');
  });

  it('fails when filename does not equal claim id', () => {
    const root = repoWith({ 'CLM-0009.yaml': claimYaml({ id: 'CLM-0001' }) });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('filename must equal claim id');
  });

  it('fails a registry file that violates the schema', () => {
    const root = repoWith({ 'CLM-0001.yaml': claimYaml({ status: 'aspirational' }) });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('CLM-0001.yaml: schema violation at status');
  });

  it('fails on invalid YAML', () => {
    const root = repoWith({ 'CLM-0001.yaml': 'id: [unclosed' });
    const result = runClaimsCheck({ repoRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('invalid YAML');
  });

  it('fails when the registry directory is missing or empty', () => {
    const missing = makeRepo({ 'README.keep': '' });
    expect(runClaimsCheck({ repoRoot: missing }).ok).toBe(false);
    const empty = makeRepo({ 'claims/registry/.gitkeep': '' });
    expect(runClaimsCheck({ repoRoot: empty }).ok).toBe(false);
  });
});

describe('cli', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('prints the summary table and leaves the exit code unset on success', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    cli(repoWith({ 'CLM-0001.yaml': claimYaml() }));
    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls.join('\n')).toContain('all evidence resolves');
  });

  it('prints each error and sets exit code 1 on failure', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    cli(repoWith({ 'CLM-0001.yaml': claimYaml({ evidence: ['ci:deploy'] }) }));
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.join('\n')).toContain('claims:check FAILED');
  });

  it('runs against this repo root by default and passes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    cli();
    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls.join('\n')).toContain('all evidence resolves');
  });
});
