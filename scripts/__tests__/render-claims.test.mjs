import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadVerifiedClaims,
  main,
  normalizeBlock,
  renderEvidence,
  renderTable,
  spliceBlock,
} from '../render-claims.mjs';

describe('renderEvidence', () => {
  test('test ref → backticked file link (survives prettier __tests__ bolding)', () => {
    expect(renderEvidence('test:scripts/__tests__/x.test.mjs::a name')).toBe(
      '[`scripts/__tests__/x.test.mjs`](scripts/__tests__/x.test.mjs)',
    );
  });
  test('ci ref → gate name', () => {
    expect(renderEvidence('ci:test')).toBe('CI `test`');
  });
  test('eval ref → backticked artifact link', () => {
    expect(renderEvidence('eval:evals/x.jsonl')).toBe('[`evals/x.jsonl`](evals/x.jsonl)');
  });
});

describe('renderTable + spliceBlock + drift', () => {
  function fixture(claims) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-render-'));
    fs.mkdirSync(path.join(root, 'claims', 'registry'), { recursive: true });
    for (const [id, body] of Object.entries(claims)) {
      fs.writeFileSync(path.join(root, 'claims', 'registry', `${id}.yaml`), body);
    }
    return root;
  }

  test('renders only verified claims, sorted by id, with deduped evidence', () => {
    const root = fixture({
      'CLM-0002': 'id: CLM-0002\nstatus: planned\nevidence: []\n',
      'CLM-0001':
        "id: CLM-0001\nstatus: verified\nevidence:\n  - 'test:a.test.ts::x'\n  - 'test:a.test.ts::y'\n  - 'ci:test'\n",
    });
    const claims = loadVerifiedClaims(path.join(root, 'claims', 'registry'));
    expect(claims.map((c) => c.id)).toEqual(['CLM-0001']);
    const table = renderTable(claims);
    expect(table).toContain('[CLM-0001](claims/registry/CLM-0001.yaml)');
    // a.test.ts appears once (deduped) plus the CI gate.
    expect(table.match(/a\.test\.ts/g)).toHaveLength(2); // link text + href, one entry
    expect(table).toContain('CI `test`');
  });

  test('main --check is green when the README block matches, red after a registry change', () => {
    const root = fixture({
      'CLM-0001': "id: CLM-0001\nstatus: verified\nevidence:\n  - 'test:a.test.ts::x'\n",
    });
    fs.writeFileSync(
      path.join(root, 'README.md'),
      `# x\n\n<!-- enforcement:begin -->\n<!-- enforcement:end -->\n`,
    );
    expect(main(root, false)).toBe(0); // writes
    expect(main(root, true)).toBe(0); // now current
    fs.writeFileSync(
      path.join(root, 'claims', 'registry', 'CLM-0003.yaml'),
      "id: CLM-0003\nstatus: verified\nevidence:\n  - 'test:b.test.ts::z'\n",
    );
    expect(main(root, true)).toBe(1); // drift detected
  });

  test('spliceBlock throws when markers are missing', () => {
    expect(() => spliceBlock('# no markers', 'table')).toThrow('markers');
  });

  test('normalizeBlock collapses prettier column padding and dash runs', () => {
    const aligned = `${'<!-- enforcement:begin -->'}\n| A | B |\n| --- | --- |\n| x   |   y |\n${'<!-- enforcement:end -->'}`;
    const tight = `${'<!-- enforcement:begin -->'}\n|A|B|\n|-|-|\n|x|y|\n${'<!-- enforcement:end -->'}`;
    expect(normalizeBlock(aligned)).toBe(normalizeBlock(tight));
  });

  test('normalizeBlock preserves dash-runs inside content cells (no false-clean drift)', () => {
    // A `--` inside a content path is real drift, not column alignment.
    const a = `${'<!-- enforcement:begin -->'}\n| x | a--b.ts |\n${'<!-- enforcement:end -->'}`;
    const b = `${'<!-- enforcement:begin -->'}\n| x | a-b.ts |\n${'<!-- enforcement:end -->'}`;
    expect(normalizeBlock(a)).not.toBe(normalizeBlock(b));
  });
});
