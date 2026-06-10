/**
 * `claims:check` — the blocking gate that makes the registry mean something.
 * Invoked from the repo root as `tsx claims/src/check.ts` (wired as the root
 * `claims:check` script). Exits 1 with precise messages when:
 *   (a) a registry file fails schema validation, ids are duplicated, or a
 *       filename does not equal its claim id;
 *   (b) any evidence ref does not resolve (see resolve.ts for semantics —
 *       claims:check verifies test EXISTENCE by name; CI orders this job
 *       after the test job, so green here implies the tests also ran green);
 *   (c) a claim is `verified` with zero test evidence;
 *   (d) the capability-statement lint fails on README.md / ARCHITECTURE.md.
 * On success prints a summary table (id → statement → evidence count).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRegistry, type RegistryClaim } from './registry.js';
import { resolveEvidence } from './resolve.js';
import { lintCapabilityDocs } from './lint.js';

export interface CheckOptions {
  /** Repo root that paths in evidence refs are resolved against. */
  repoRoot: string;
  /** Registry directory; defaults to `<repoRoot>/claims/registry`. */
  registryDir?: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  claims: RegistryClaim[];
}

/** Run the full claims:check pipeline. Pure function of the filesystem; no exit. */
export function runClaimsCheck(options: CheckOptions): CheckResult {
  const repoRoot = path.resolve(options.repoRoot);
  const registryDir = options.registryDir ?? path.join(repoRoot, 'claims', 'registry');
  const { claims, errors } = loadRegistry(registryDir);
  for (const { file, claim } of claims) {
    for (const ref of claim.evidence) {
      const failure = resolveEvidence(ref, repoRoot);
      if (failure !== null) {
        errors.push(`${file} (${claim.id}): unresolved evidence ${failure}`);
      }
    }
    if (claim.status === 'verified' && !claim.evidence.some((e) => e.kind === 'test')) {
      errors.push(
        `${file} (${claim.id}): status is "verified" but the claim has zero test evidence`,
      );
    }
  }
  const knownIds = new Set(claims.map((c) => c.claim.id));
  errors.push(...lintCapabilityDocs(repoRoot, knownIds));
  return { ok: errors.length === 0, errors, claims };
}

/** Render the success summary: id → statement → evidence count. */
export function summaryTable(claims: RegistryClaim[]): string {
  const rows = [...claims].sort((a, b) => a.claim.id.localeCompare(b.claim.id));
  const lines = rows.map(({ claim }) => {
    const statement =
      claim.statement.length > 72 ? `${claim.statement.slice(0, 69)}...` : claim.statement;
    return `${claim.id}  ${statement.padEnd(72)}  ${String(claim.evidence.length).padStart(2)} evidence`;
  });
  return [`claims:check ✓ ${rows.length} claims, all evidence resolves`, ...lines].join('\n');
}

/** CLI entry: run against the real repo root and exit nonzero on failure. */
export function cli(repoRootOverride?: string): void {
  const repoRoot =
    repoRootOverride ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = runClaimsCheck({ repoRoot });
  if (!result.ok) {
    console.error(`claims:check FAILED — ${result.errors.length} error(s):`);
    for (const error of result.errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(summaryTable(result.claims));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  cli();
}
