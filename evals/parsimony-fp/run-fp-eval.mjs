#!/usr/bin/env node
/**
 * FP-rate eval RUNNER for the blind parsimony verifier (#436) — drives the REAL
 * `verifyFloor` (packages/cli/src/loop/parsimony-verify.ts) over the labeled
 * corpus in `corpus/*.json`, through the SAME seam the parsimony gate binds:
 * the review-tier node seam (`nodeRequirement('review')` → `resolveServed` →
 * `buildNodeSeam` over `adapterInvoke`, tool-free), so the measured verdicts
 * come from the exact code path + posture that gates children at enforce/full
 * (CLM-0177). Each (case × rep) appends one JSON line to `results.jsonl`;
 * `pnpm parsimony:fp` (scripts/parsimony-fp-check.mjs) scores the committed
 * ledger deterministically.
 *
 * NOT run in CI — every rep is a real model call on the chosen adapter's CLI
 * (~1 verifier call per rep for these single-chunk diffs). Operator-run, like
 * the vote-parity DPs (evals/vote-parity/README.md). Requires `pnpm build`
 * first (imports the built dist through the package seam, not a re-implementation).
 *
 * Usage:
 *   node evals/parsimony-fp/run-fp-eval.mjs [--adapter claude] [--reps 3]
 *        [--case <id>] [--out evals/parsimony-fp/results.jsonl]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const CORPUS_DIR = path.join(here, 'corpus');
const DEFAULT_OUT = path.join(here, 'results.jsonl');

/** Parse the small flag set; anything unknown fails loud. */
function parseArgs(argv) {
  const args = { adapter: 'claude', reps: 3, caseId: undefined, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === '--adapter') args.adapter = value;
    else if (flag === '--reps') args.reps = Number.parseInt(value, 10);
    else if (flag === '--case') args.caseId = value;
    else if (flag === '--out') args.out = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(args.reps) || args.reps < 1) throw new Error('--reps must be >= 1');
  return args;
}

/** Import the REAL gate modules from the built dist — fail loud when unbuilt. */
async function loadGateModules() {
  const cliLoop = path.join(root, 'packages', 'cli', 'dist', 'loop');
  const parsimonyDist = path.join(root, 'packages', 'parsimony', 'dist');
  for (const f of [
    path.join(cliLoop, 'parsimony-verify.js'),
    path.join(parsimonyDist, 'floor.js'),
  ]) {
    if (!fs.existsSync(f)) throw new Error(`built dist missing (${f}) — run \`pnpm build\` first`);
  }
  const load = (dir, file) => import(pathToFileURL(path.join(dir, file)).href);
  const [verify, invoke, nodeModel, nodeSeam, floor] = await Promise.all([
    load(cliLoop, 'parsimony-verify.js'),
    load(cliLoop, 'invoke.js'),
    load(cliLoop, 'node-model.js'),
    load(cliLoop, 'node-seam.js'),
    load(parsimonyDist, 'floor.js'),
  ]);
  return { verify, invoke, nodeModel, nodeSeam, floor };
}

/** Load + minimally validate the labeled corpus (a mislabeled case fails loud). */
function loadCorpus(caseId) {
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const cases = files.map((f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')));
  for (const c of cases) {
    const bad =
      typeof c.id !== 'string' ||
      !Array.isArray(c.claimedPass) ||
      c.claimedPass.length === 0 ||
      typeof c.diff !== 'string' ||
      c.diff.length === 0 ||
      typeof c.labelProvenance !== 'string' ||
      typeof c.scored !== 'boolean' ||
      c.claimedPass.some((g) => typeof c.groundTruth?.[g] !== 'boolean');
    if (bad) throw new Error(`corpus case is malformed or missing ground truth: ${c.id ?? '?'}`);
  }
  const picked = caseId === undefined ? cases : cases.filter((c) => c.id === caseId);
  if (picked.length === 0) throw new Error(`no corpus case matches --case ${caseId}`);
  return picked;
}

/** The verdict the ground truth demands: confirmed iff EVERY claimed guard truly holds. */
function expectedVerdict(c) {
  return c.claimedPass.every((g) => c.groundTruth[g] === true) ? 'confirmed' : 'refuted';
}

/** Claimed-pass FloorChecks from the REAL Control Floor entries (never invented). */
function toFloorChecks(claimedPass, CONTROL_FLOOR) {
  return claimedPass.map((name) => {
    const entry = CONTROL_FLOOR.find((e) => e.name === name);
    if (entry === undefined) throw new Error(`unknown floor guard in corpus: ${name}`);
    return {
      name: entry.name,
      catalog: entry.catalog,
      controlIds: [...entry.controlIds],
      status: 'pass',
    };
  });
}

/**
 * The review-tier verifier seam, built exactly as the gate's composition root
 * builds it with no overlay overrides (node-bind.ts `buildInvokeForNode`):
 * review requirement from the gate manifest, served model resolved on the
 * adapter, tool-free (reasoning node), metered.
 */
function buildReviewSeam(mods, adapter, totals) {
  const { nodeModel, nodeSeam, invoke } = mods;
  invoke.ensureAdapterAvailable(adapter);
  const served = nodeSeam.resolveServed(nodeModel.nodeRequirement('review'), adapter);
  const timeoutMs = nodeModel.invokeTimeoutForNode('review', nodeModel.DEFAULT_INVOKE_TIMEOUT_MS);
  const seam = nodeSeam.buildNodeSeam(
    served,
    invoke.adapterInvoke(adapter),
    totals,
    timeoutMs,
    {},
    nodeModel.isReasoningNode('review'),
  );
  return { seam, servedRef: nodeSeam.servedRef(served) };
}

/** Run ONE (case, rep): real verifier call(s); a malformed emission is recorded
 * honestly as `parse_error` (the gate would THROW there, never fabricate). */
async function runOne(mods, seamInvoke, overlayDir, c, rep) {
  const checks = toFloorChecks(c.claimedPass, mods.floor.CONTROL_FLOOR);
  const verifySeam = { overlayDir, childId: `${c.id}-r${rep}`, invoke: seamInvoke };
  const started = Date.now();
  try {
    const result = await mods.verify.verifyFloor(verifySeam, c.diff, checks);
    return {
      verdict: result.status,
      refutedChecks: result.refutedChecks,
      tokens: result.cost.tokens,
      usd: result.cost.usd,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      verdict: 'parse_error',
      refutedChecks: [],
      tokens: 0,
      usd: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mods = await loadGateModules();
  const cases = loadCorpus(args.caseId);
  const totals = { tokens: 0, usd: 0 };
  const { seam, servedRef } = buildReviewSeam(mods, args.adapter, totals);
  const overlayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-fp-eval-'));
  const date = new Date().toISOString().slice(0, 10);
  console.error(`parsimony-fp eval: ${cases.length} cases × ${args.reps} reps on ${servedRef}`);
  for (const c of cases) {
    const expected = expectedVerdict(c);
    for (let rep = 1; rep <= args.reps; rep += 1) {
      const r = await runOne(mods, seam.invoke, overlayDir, c, rep);
      const row = {
        date,
        adapter: args.adapter,
        served: servedRef,
        caseId: c.id,
        rep,
        scored: c.scored,
        expected,
        verdict: r.verdict,
        refutedChecks: r.refutedChecks,
        agree: r.verdict === expected,
        tokens: r.tokens,
        usd: r.usd,
        ms: r.ms,
        ...(r.error === undefined ? {} : { error: r.error }),
      };
      fs.appendFileSync(args.out, `${JSON.stringify(row)}\n`); // crash-safe: one line per rep
      console.error(
        `  ${c.id} rep ${rep}/${args.reps}: ${r.verdict}${row.agree ? '' : ` (expected ${expected})`} [${r.ms}ms]`,
      );
    }
  }
  console.error(`\nappended to ${args.out} — score with \`pnpm parsimony:fp\``);
  console.error(
    `model spend: ${totals.tokens} tokens, $${totals.usd.toFixed(4)} (as metered by the adapter)`,
  );
}

await main();
