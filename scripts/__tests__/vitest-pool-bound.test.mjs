import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A sane ceiling for maxWorkers: the whole point of #420 is to bound the inner
// pool so peak ≈ turbo_concurrency × per_package_forks stays modest. A value
// above this would re-open the fork-storm even with bounded turbo concurrency.
const MAX_FORKS_CEILING = 8;

// vitest 4 removed `poolOptions.forks.maxForks`; the inner-pool size is now the
// top-level `maxWorkers` (the old key is silently ignored). The guard asserts
// the EFFECTIVE key so a regression to the dead `maxForks` key would fail here.
function poolBound(src) {
  // pool must be forks (the unbounded default on a high-core box).
  const poolForks = /pool:\s*['"]forks['"]/.test(src);
  const m = src.match(/maxWorkers:\s*(\d+)/);
  return { poolForks, maxWorkers: m ? Number(m[1]) : undefined };
}

// The ONE source of the bound (#420). If this regresses, the per-package merge
// inherits an unbounded pool again.
test('vitest.shared.ts pins a bounded forks pool', () => {
  const src = readFileSync(path.join(repoRoot, 'vitest.shared.ts'), 'utf8');
  const { poolForks, maxWorkers } = poolBound(src);
  expect(poolForks).toBe(true);
  expect(maxWorkers).toBeDefined();
  expect(maxWorkers).toBeGreaterThanOrEqual(1);
  expect(maxWorkers).toBeLessThanOrEqual(MAX_FORKS_CEILING);
});

// The root coverage run shares the same `pnpm test` invocation as
// `turbo run test`, so it must mirror the bound (it cannot import the .ts).
test('vitest.root.config.mjs mirrors the bounded forks pool', () => {
  const src = readFileSync(path.join(repoRoot, 'vitest.root.config.mjs'), 'utf8');
  const { poolForks, maxWorkers } = poolBound(src);
  expect(poolForks).toBe(true);
  expect(maxWorkers).toBeDefined();
  expect(maxWorkers).toBeLessThanOrEqual(MAX_FORKS_CEILING);
});

// EVERY package config must merge the shared base so the bound is inherited from
// ONE source. contracts + kernel were initially excluded (#420 was a test-infra
// PR and could not touch those protected paths) but are now bound at source via
// the #443 human-review PR — so the guard enforces ALL packages, no exclusions.
test('every package vitest config merges the shared bound', () => {
  const pkgDir = path.join(repoRoot, 'packages');
  const offenders = [];
  for (const pkg of readdirSync(pkgDir)) {
    const cfg = path.join(pkgDir, pkg, 'vitest.config.ts');
    let src;
    try {
      src = readFileSync(cfg, 'utf8');
    } catch {
      continue; // package has no vitest.config.ts
    }
    if (!src.includes('sharedTestConfig') || !src.includes('mergeConfig')) {
      offenders.push(pkg);
    }
  }
  expect(offenders).toEqual([]);
});

// The root `pnpm test` script must ALSO bound turbo concurrency — the bound is
// multiplicative (turbo_concurrency × per_package_forks), so capping the inner
// pool alone is not enough (#420).
test('the root test script bounds turbo concurrency', () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const m = pkg.scripts.test.match(/turbo run test --concurrency=(\d+)/);
  expect(m, 'pnpm test must run `turbo run test --concurrency=<N>`').not.toBeNull();
  expect(Number(m[1])).toBeLessThanOrEqual(MAX_FORKS_CEILING);
});
