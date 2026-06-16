import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  danglingClaimIds,
  loadVerifiedClaims,
  main,
  normalizeBlock,
  referencedClaimIds,
  renderCatalog,
  renderClaimLinks,
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
  test('doc ref → backticked file link', () => {
    expect(renderEvidence('doc:README.md#claims')).toBe('[`README.md#claims`](README.md#claims)');
  });
  test('code ref → backticked path#symbol link, stripping the @doc suffix', () => {
    expect(renderEvidence('code:src/loop.ts#CANONICAL_LOOP@doc:/canonical loop/')).toBe(
      '[`src/loop.ts#CANONICAL_LOOP`](src/loop.ts)',
    );
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

describe('claim-links block + dangling check (#219)', () => {
  function fixture(claims) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-links-'));
    fs.mkdirSync(path.join(root, 'claims', 'registry'), { recursive: true });
    for (const [id, body] of Object.entries(claims)) {
      fs.writeFileSync(path.join(root, 'claims', 'registry', `${id}.yaml`), body);
    }
    return root;
  }

  test('referencedClaimIds collects DISTINCT prose tags, excluding the link block', () => {
    const readme =
      'foo [CLM-0001] bar [CLM-0003] [CLM-0001]\n' +
      '<!-- claim-links:begin -->\n[CLM-0099]: x\n<!-- claim-links:end -->';
    expect(referencedClaimIds(readme)).toEqual(['CLM-0001', 'CLM-0003']); // 0099 (in the block) excluded
  });

  test('renderCatalog emits an anchored section per claim with status, statement, evidence, source', () => {
    const catalog = renderCatalog([
      {
        id: 'CLM-0001',
        status: 'verified',
        statement: 'A real capability.',
        evidence: ['test:a.test.ts::x', 'ci:test'],
      },
    ]);
    expect(catalog).toContain('## CLM-0001'); // GitHub anchors this to #clm-0001
    expect(catalog).toContain('**Status:** verified');
    expect(catalog).toContain('A real capability.');
    expect(catalog).toContain('[`a.test.ts`](../a.test.ts)'); // docs/ → ../ prefix
    expect(catalog).toContain('[`CLM-0001.yaml`](../claims/registry/CLM-0001.yaml)');
  });

  test('renderClaimLinks points each tag at its catalog anchor', () => {
    expect(renderClaimLinks(['CLM-0001', 'CLM-0002'])).toBe(
      '[CLM-0001]: docs/CLAIMS.md#clm-0001\n[CLM-0002]: docs/CLAIMS.md#clm-0002',
    );
  });

  test('danglingClaimIds flags a referenced id with no registry file', () => {
    const root = fixture({ 'CLM-0001': 'id: CLM-0001\nstatus: verified\nevidence: []\n' });
    const dir = path.join(root, 'claims', 'registry');
    expect(danglingClaimIds(['CLM-0001', 'CLM-0404'], dir)).toEqual(['CLM-0404']);
  });

  test('main writes the link block, is --check green, and FAILS on a dangling tag', () => {
    const root = fixture({
      'CLM-0001': "id: CLM-0001\nstatus: verified\nevidence:\n  - 'test:a.test.ts::x'\n",
    });
    fs.writeFileSync(
      path.join(root, 'README.md'),
      '# x\n\nProse cites [CLM-0001].\n\n' +
        '<!-- enforcement:begin -->\n<!-- enforcement:end -->\n\n' +
        '<!-- claim-links:begin -->\n<!-- claim-links:end -->\n',
    );
    expect(main(root, false)).toBe(0); // writes both blocks + the catalog
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain(
      '[CLM-0001]: docs/CLAIMS.md#clm-0001',
    );
    // The catalog was generated with an anchored section + the YAML back-link.
    const catalog = fs.readFileSync(path.join(root, 'docs', 'CLAIMS.md'), 'utf8');
    expect(catalog).toContain('## CLM-0001');
    expect(catalog).toContain('../claims/registry/CLM-0001.yaml');
    expect(main(root, true)).toBe(0); // current
    fs.appendFileSync(path.join(root, 'README.md'), '\nAlso [CLM-0404].\n'); // a tag with no file
    expect(main(root, true)).toBe(1); // dangling → fail
  });
});
