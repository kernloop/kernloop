import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkRefs,
  collectTestRefs,
  flattenResults,
  main,
  nameMatcher,
} from '../verify-claim-tests.mjs';

describe('nameMatcher', () => {
  test('exact match for a plain name', () => {
    const m = nameMatcher('does a thing');
    expect(m('does a thing')).toBe(true);
    expect(m('does a thing extra')).toBe(false);
  });

  test('printf .each template matches expanded titles', () => {
    const m = nameMatcher('seed %i: holds');
    expect(m('seed 1: holds')).toBe(true);
    expect(m('seed 42: holds')).toBe(true);
    expect(m('seed : holds')).toBe(false);
  });
});

describe('flattenResults', () => {
  test('flattens vitest/jest report into status rows', () => {
    const rows = flattenResults({
      testResults: [
        { assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }] },
        { assertionResults: [{ title: 'b', fullName: 'x > b', status: 'skipped' }] },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe('skipped');
  });
});

describe('checkRefs — the ran-and-passed proof', () => {
  const rows = [
    { title: 'passing one', fullName: 'passing one', status: 'passed' },
    { title: 'skipped one', fullName: 'skipped one', status: 'skipped' },
    { title: 'seed 1: prop', fullName: 'seed 1: prop', status: 'passed' },
  ];

  test('a passing cited test resolves clean', () => {
    expect(checkRefs([{ claim: 'CLM-0001', file: 'x', testName: 'passing one' }], rows)).toEqual(
      [],
    );
  });

  test('a skipped cited test is rejected (the describe.skip / --skip catch)', () => {
    const errs = checkRefs([{ claim: 'CLM-0002', file: 'x', testName: 'skipped one' }], rows);
    expect(errs[0]).toContain('did not pass');
    expect(errs[0]).toContain('skipped');
  });

  test('a cited test that never ran is rejected', () => {
    const errs = checkRefs([{ claim: 'CLM-0003', file: 'x', testName: 'ghost' }], rows);
    expect(errs[0]).toContain('never ran');
  });

  test('a printf .each cite resolves against expanded passing titles', () => {
    expect(checkRefs([{ claim: 'CLM-0004', file: 'x', testName: 'seed %i: prop' }], rows)).toEqual(
      [],
    );
  });
});

describe('collectTestRefs + main', () => {
  function fixtureRepo(claims, results) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-verify-'));
    fs.mkdirSync(path.join(root, 'claims', 'registry'), { recursive: true });
    for (const [id, evidence] of Object.entries(claims)) {
      fs.writeFileSync(
        path.join(root, 'claims', 'registry', `${id}.yaml`),
        `id: ${id}\nevidence:\n${evidence.map((e) => `  - '${e}'`).join('\n')}\n`,
      );
    }
    const resultsFile = path.join(root, 'results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results));
    return { root, resultsFile };
  }

  test('collects only test: refs from the registry', () => {
    const { root } = fixtureRepo(
      { 'CLM-0001': ['test:src/a.test.ts::alpha', 'ci:test', 'eval:x'] },
      { testResults: [] },
    );
    const refs = collectTestRefs(path.join(root, 'claims', 'registry'));
    expect(refs).toEqual([{ claim: 'CLM-0001', file: 'src/a.test.ts', testName: 'alpha' }]);
  });

  test('main returns 0 when every cited test passed', () => {
    const { root, resultsFile } = fixtureRepo(
      { 'CLM-0001': ['test:src/a.test.ts::alpha'] },
      {
        testResults: [
          { assertionResults: [{ title: 'alpha', fullName: 'alpha', status: 'passed' }] },
        ],
      },
    );
    expect(main(root, resultsFile)).toBe(0);
  });

  test('main returns 1 when a cited test failed', () => {
    const { root, resultsFile } = fixtureRepo(
      { 'CLM-0001': ['test:src/a.test.ts::alpha'] },
      {
        testResults: [
          { assertionResults: [{ title: 'alpha', fullName: 'alpha', status: 'failed' }] },
        ],
      },
    );
    expect(main(root, resultsFile)).toBe(1);
  });
});
