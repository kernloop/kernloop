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
 * NOT a CI gate: CI hosts lack the authed CLIs. The static argv/injection-safety
 * companion runs in CI as scripts/__tests__/adapter-effort-safety.test.mjs.
 * This file runs main() on import, so it is excluded from unit-coverage scope
 * (vitest.root.config.mjs), like scripts/sampling-host-harness.mjs.
 */
import {
  ADAPTER_NAMES,
  adapterDefinitions,
  detectAdapter,
  invokeAdapter,
  resolveEffort,
} from '@kernloop/kernel';

const TIMEOUT_MS = 120_000;
const PROMPT = 'Reply with exactly the two characters: OK';

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
    const detail = `exit ${result.raw.exitCode} · "${output.slice(0, 40).replace(/\s+/g, ' ')}"`;
    return { name, status: output.length > 0 ? 'PASS' : 'FAIL', detail };
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
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nadapters:smoke — ${pass} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail > 0 ? 1 : 0);
}

await main();
