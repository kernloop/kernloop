import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * The ran-and-passed gate (companion to `claims:check`). `claims:check`
 * statically proves a cited test exists, is not disabled, and is non-empty.
 * THIS gate proves it actually RAN and PASSED: it runs the whole suite once
 * with the JSON reporter and asserts every `test:` evidence ref in the
 * registry maps to an assertion result with status `passed`. It catches what
 * a static scan cannot — `describe.skip`, CLI `--skip`, a renamed or deleted
 * test, and outright failures. A claim is only honestly "verified" when both
 * gates are green.
 */

/** Convert a registry test name (possibly a printf `.each` template) to a matcher. */
export function nameMatcher(testName) {
  if (/%[sdifjo#%]/.test(testName)) {
    // A name that is nothing but wildcards (e.g. "%s") would match every
    // title — it is not a usable cite. Require literal content to anchor on.
    if (
      testName
        .replace(/%%/g, '')
        .replace(/%[sdifjo#]/g, '')
        .trim().length === 0
    ) {
      return () => false;
    }
    const rx = testName
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%%/g, '%')
      .replace(/%[sdifjo#]/g, '.+');
    const re = new RegExp(`^${rx}$`);
    return (title) => re.test(title);
  }
  return (title) => title === testName;
}

/** Collect every `test:<path>::<name>` evidence ref across the registry. */
export function collectTestRefs(registryDir) {
  const refs = [];
  for (const file of fs.readdirSync(registryDir).filter((f) => f.endsWith('.yaml'))) {
    const claim = parseYaml(fs.readFileSync(path.join(registryDir, file), 'utf8'));
    for (const raw of claim.evidence ?? []) {
      if (typeof raw === 'string' && raw.startsWith('test:')) {
        const body = raw.slice('test:'.length);
        const sep = body.indexOf('::');
        if (sep !== -1) {
          refs.push({ claim: claim.id, file: body.slice(0, sep), testName: body.slice(sep + 2) });
        }
      }
    }
  }
  return refs;
}

/** Flatten a vitest/jest-style JSON report into {file, title, status} rows. */
export function flattenResults(report) {
  const rows = [];
  for (const suite of report.testResults ?? []) {
    // `suite.name` is the absolute test file path; normalize separators so a
    // POSIX `ref.file` suffix match works regardless of platform.
    const file = (suite.name ?? '').split('\\').join('/');
    for (const a of suite.assertionResults ?? []) {
      rows.push({ file, title: a.title, fullName: a.fullName, status: a.status });
    }
  }
  return rows;
}

/**
 * Cross-check every test ref against the run results. A cited test must match
 * by name AND come from the cited file — otherwise a deleted/renamed test
 * could be satisfied by an identically-named test in a different file.
 */
export function checkRefs(refs, rows) {
  const errors = [];
  for (const ref of refs) {
    const match = nameMatcher(ref.testName);
    const inFile = rows.filter((r) => r.file.endsWith(ref.file));
    if (inFile.length === 0) {
      errors.push(`${ref.claim}: cited test file did not run: ${ref.file}`);
      continue;
    }
    const hits = inFile.filter((r) => match(r.title) || (r.fullName && match(r.fullName)));
    if (hits.length === 0) {
      errors.push(`${ref.claim}: cited test never ran: "${ref.testName}" (${ref.file})`);
      continue;
    }
    const notPassed = hits.filter((h) => h.status !== 'passed');
    if (notPassed.length > 0) {
      const statuses = [...new Set(notPassed.map((h) => h.status))].join(', ');
      errors.push(`${ref.claim}: cited test did not pass (${statuses}): "${ref.testName}"`);
    }
  }
  return errors;
}

export function main(repoRoot, resultsFile) {
  const refs = collectTestRefs(path.join(repoRoot, 'claims', 'registry'));
  const report = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const rows = flattenResults(report);
  const errors = checkRefs(refs, rows);
  for (const e of errors) console.error(`verify-claim-tests ✗ ${e}`);
  if (errors.length > 0) {
    console.error(`verify-claim-tests: ${errors.length} cited test(s) did not run-and-pass`);
    return 1;
  }
  console.log(`verify-claim-tests ✓ ${refs.length} cited tests all ran and passed`);
  return 0;
}

/* v8 ignore start -- CLI entry: runs the suite, then verifies the manifest */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resultsFile =
    process.argv[2] ??
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-results-')), 'r.json');
  if (process.argv[2] === undefined) {
    try {
      execFileSync(
        path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
        [
          'run',
          '--config',
          'vitest.ci.config.mjs',
          '--reporter=json',
          `--outputFile=${resultsFile}`,
        ],
        { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } catch {
      // vitest exits non-zero on test failure; the manifest is still written
      // and checkRefs will surface exactly which cited tests failed.
    }
  }
  process.exit(main(repoRoot, resultsFile));
}
/* v8 ignore stop */
