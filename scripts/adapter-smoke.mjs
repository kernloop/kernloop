#!/usr/bin/env node
/**
 * Opt-in adapter smoke harness (#380) — `pnpm adapters:smoke`.
 *
 * For every adapter detected on PATH, drives the REAL kernel invoke path
 * (`invokeAdapter` over the adapter's own `buildCommand`) through a trivial
 * pure-completion turn carrying the resolved effort knob, and reports per-adapter
 * health: PASS (exit-0 + parseable output), FAIL (error / empty output), or SKIP
 * (not on PATH). This is the repeatable form of the manual #373 live validation
 * that caught the codex effort-flag bug (#379) — run it on an adapter-CLI upgrade.
 *
 * It ALSO checks metering DRIFT (#464): the static `metersUsd`/`metersTokens` facts on
 * each adapter definition (#462) are point-in-time claims about that CLI's output format;
 * a real call's runtime `metered` flags are ground truth. If they diverge — a CLI version
 * stops emitting cost, or starts emitting tokens — the static fact has silently gone stale
 * and `buildCost` would coerce honestly-unknown figures, so the smoke reports DRIFT and
 * fails. The pure {@link meteringDrift} comparator is unit-tested in
 * scripts/__tests__/metering-drift.test.mjs.
 *
 * NOT a CI gate: CI hosts lack the authed CLIs. The static argv/injection-safety
 * companion runs in CI as scripts/__tests__/adapter-effort-safety.test.mjs.
 * main() runs only when invoked directly (not on import), so the comparator can be
 * imported for the unit test; like scripts/sampling-host-harness.mjs it is excluded
 * from unit-coverage scope (vitest.root.config.mjs).
 */
import { pathToFileURL } from 'node:url';
import {
  ADAPTER_NAMES,
  adapterDefinitions,
  detectAdapter,
  invokeAdapter,
  resolveEffort,
} from '@kernloop/kernel';

const TIMEOUT_MS = 120_000;
const PROMPT = 'Reply with exactly the two characters: OK';

/**
 * Drift between an adapter's STATIC metering facts and a real call's RUNTIME metered flags
 * (#464). Returns a list of human-readable drift messages (empty = consistent). A mismatch
 * in EITHER direction is drift: a `metersUsd:true` adapter that reported no cost has gone
 * stale (its declared fact now over-claims, and cost silently reads $0), and a
 * `metersUsd:false` adapter that DID report cost is under-claiming (the fact should flip).
 * Same for tokens. Pure — `observed` is the AdapterResult.metered ({tokens, usd} booleans).
 */
export function meteringDrift(name, observed) {
  const def = adapterDefinitions[name];
  const drift = [];
  if (def.metersUsd !== observed.usd) {
    drift.push(`usd: static metersUsd=${def.metersUsd} but the call metered usd=${observed.usd}`);
  }
  if (def.metersTokens !== observed.tokens) {
    drift.push(
      `tokens: static metersTokens=${def.metersTokens} but the call metered tokens=${observed.tokens}`,
    );
  }
  return drift;
}

/** The resolved AdapterCommandEffort the loop would ride into argv, or undefined. */
function effortFor(name) {
  const profile = adapterDefinitions[name].effort;
  if (profile === undefined) return undefined;
  const { value } = resolveEffort('medium', profile);
  return value === undefined ? undefined : { param: profile.param, value, via: profile.via };
}

/** Smoke one adapter: SKIP if absent, else PASS/FAIL on a real pure-completion turn. */
async function smokeOne(name) {
  const availability = detectAdapter(name);
  if (!availability.available) {
    return { name, status: 'SKIP', detail: 'not on PATH' };
  }
  try {
    const result = await invokeAdapter(name, {
      prompt: PROMPT,
      timeoutMs: TIMEOUT_MS,
      effort: effortFor(name),
      pureCompletion: true,
    });
    const output = result.output.trim();
    const base = `exit ${result.raw.exitCode} · "${output.slice(0, 40).replace(/\s+/g, ' ')}"`;
    if (output.length === 0) return { name, status: 'FAIL', detail: base };
    // The call succeeded; now check its runtime metering against the static facts (#464).
    const drift = meteringDrift(name, result.metered);
    if (drift.length > 0) return { name, status: 'DRIFT', detail: `${base} · ${drift.join('; ')}` };
    return { name, status: 'PASS', detail: base };
  } catch (error) {
    return { name, status: 'FAIL', detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const results = [];
  for (const name of ADAPTER_NAMES) {
    results.push(await smokeOne(name));
  }
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.name.padEnd(10)} ${r.detail}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  const [pass, fail, drift, skip] = [count('PASS'), count('FAIL'), count('DRIFT'), count('SKIP')];
  console.log(`\nadapters:smoke — ${pass} pass · ${fail} fail · ${drift} drift · ${skip} skip`);
  process.exit(fail + drift > 0 ? 1 : 0); // metering drift fails the run (#464)
}

// Run only when invoked directly (`pnpm adapters:smoke`), so the test can import
// meteringDrift without driving real adapters.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
