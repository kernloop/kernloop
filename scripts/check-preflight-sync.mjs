#!/usr/bin/env node
/**
 * Drift gate for the `preflight` aggregate command (#449). The root `package.json`
 * carries a `preflight` script that chains the locally-reproducible CI gates so a
 * contributor (or agent) can reproduce a green CI run before pushing. This check
 * asserts `preflight` stays in lockstep with `.github/workflows/ci.yml`: every gate
 * CI runs (that is runnable locally) must appear in `preflight`. Add a CI gate
 * without adding it here and this check goes red — so `preflight` cannot silently
 * rot into a stale subset (the exact failure #449 was filed to prevent).
 *
 * Matching is alias-aware: a `pnpm <name>` command is resolved ONE level through
 * `package.json` scripts so `pnpm governance:check` and the raw
 * `node scripts/governance-check.mjs` CI invocation canonicalize to the same gate.
 * Commands that need CI infrastructure (the lockfile install) are CI-only and
 * exempt — they are not gates a local `preflight` should re-run.
 *
 * TWO workflows are checked, DELIBERATELY ASYMMETRICALLY:
 *   - ci.yml       — FULLY fail-closed: EVERY single-line `run:` is a required gate
 *                    (see {@link requiredGates}), and a multi-line block scalar fails
 *                    LOUD ({@link blockScalarRunLines}) so no gate can hide in one.
 *   - security.yml — pnpm SINGLE-LINE gates ONLY (see {@link requiredPnpmGates}). Its
 *                    non-pnpm scanners (gitleaks / semgrep) and their block-scalar
 *                    installers are NOT locally-reproducible preflight gates, so the
 *                    fail-closed requiredGates + block-scalar fail-loud paths are NOT
 *                    applied to it — only its `pnpm audit`-shaped steps fold in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Raw CI `run:` commands that are NOT local gates (need CI infra / are prerequisites
 * a local working tree already satisfies). Matched against the raw command string. */
export const CI_ONLY = [/^pnpm install\b/];

/** Collapse whitespace so two spellings of the same command compare equal. */
export function normalizeCmd(cmd) {
  return cmd.trim().replace(/\s+/g, ' ');
}

/**
 * Resolve a command ONE level through the package.json `scripts` map: `pnpm <name>`
 * becomes the script's definition, with any `-- <args>` suffix appended (so
 * `pnpm docs:render -- --check` resolves to the underlying renderer + `--check`).
 * A command that is not a known `pnpm <name>` (a raw `node scripts/x.mjs`, or a
 * pnpm name with no script) is returned normalized but otherwise unchanged.
 */
export function resolvePnpm(cmd, scripts) {
  const trimmed = normalizeCmd(cmd);
  const m = /^pnpm\s+(\S+)(?:\s+--\s+(.*))?$/.exec(trimmed);
  if (m && Object.prototype.hasOwnProperty.call(scripts, m[1])) {
    const base = scripts[m[1]];
    return normalizeCmd(m[2] === undefined ? base : `${base} ${m[2]}`);
  }
  return trimmed;
}

/** Pull every single-line `run:` command out of a CI workflow YAML. */
export function ciRunCommands(yaml) {
  const out = [];
  for (const line of yaml.split('\n')) {
    const m = /^\s*-?\s*run:\s*(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * `run:` lines that open a BLOCK SCALAR (`run: |`, `run: >`, with optional chomp
 * `+`/`-`) — a multi-line command the single-line {@link ciRunCommands} parser cannot
 * read. We FAIL LOUD on these (rather than silently skip, which would let a gate added
 * inside a block escape the drift check) so the parser's limitation can never become a
 * silent false-negative — extend the parser when CI first needs a multi-line step.
 *
 * Applied to ci.yml ONLY. security.yml legitimately uses block scalars for its scanner
 * installers (gitleaks), which are NOT preflight gates, so failing loud on them there
 * would be a false positive — see {@link requiredPnpmGates} and the module header.
 */
export function blockScalarRunLines(yaml) {
  // Matches `run: |`, `run: >`, and the explicit-indentation/chomp forms (`run: |2-`).
  return yaml.split('\n').filter((line) => /^\s*-?\s*run:\s*[|>][0-9]*[+-]?\s*$/.test(line));
}

/**
 * The set of resolved gate signatures CI runs locally — FAIL-CLOSED: EVERY single-line
 * `run:` command counts as a required gate unless it matches the explicit {@link CI_ONLY}
 * allowlist, resolved through `scripts` and deduped. There is no gate-FORM allowlist: a
 * gate spelled `turbo run x`, `bash scripts/x.sh`, or `npx y` is required by default, so a
 * new gate cannot escape by not looking like a pnpm/scripts command. (Block-scalar steps
 * are handled separately by {@link blockScalarRunLines}, which fails loud.)
 */
export function requiredGates(yaml, scripts) {
  const gates = new Set();
  for (const cmd of ciRunCommands(yaml)) {
    if (CI_ONLY.some((re) => re.test(cmd.trim()))) continue;
    gates.add(resolvePnpm(cmd, scripts));
  }
  return gates;
}

/**
 * The NARROW, pnpm-ONLY analogue of {@link requiredGates}, for workflows (security.yml)
 * whose non-pnpm steps are NOT locally-reproducible preflight gates. Only single-line
 * `run:` commands that normalize to `pnpm …` (and are not {@link CI_ONLY}) are folded in,
 * resolved through `scripts` and deduped — so `pnpm audit --audit-level=high` is required
 * while `gitleaks detect …`, `semgrep scan …`, and the block-scalar gitleaks installer
 * are all correctly ignored. Do NOT reuse the fail-closed {@link requiredGates} here: it
 * would wrongly demand gitleaks/semgrep, which have no local-preflight equivalent.
 */
export function requiredPnpmGates(yaml, scripts) {
  const gates = new Set();
  for (const cmd of ciRunCommands(yaml)) {
    if (!normalizeCmd(cmd).startsWith('pnpm ')) continue;
    if (CI_ONLY.some((re) => re.test(cmd.trim()))) continue;
    gates.add(resolvePnpm(cmd, scripts));
  }
  return gates;
}

/** The set of resolved gate signatures a `&&`-chained preflight script runs. */
export function preflightGates(preflight, scripts) {
  return new Set(preflight.split('&&').map((c) => resolvePnpm(c, scripts)));
}

/** Required gates not covered by preflight (the drift). Empty ⇒ in sync. */
export function missingGates(preflight, yaml, scripts) {
  const covered = preflightGates(preflight, scripts);
  return [...requiredGates(yaml, scripts)].filter((g) => !covered.has(g));
}

/** Pure check over the real repo files — returns the verdict without exiting. */
export function runCheck(repoRoot = root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const preflight = pkg.scripts?.preflight;
  if (typeof preflight !== 'string') {
    return { ok: false, reason: 'no `preflight` script in package.json', missing: [] };
  }
  const yaml = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const blocks = blockScalarRunLines(yaml);
  if (blocks.length > 0) {
    return {
      ok: false,
      reason: `ci.yml has multi-line \`run:\` block(s) the preflight-sync parser cannot read (${String(blocks.length)}); extend scripts/check-preflight-sync.mjs to parse block scalars before a gate hides inside one`,
      missing: [],
    };
  }
  const missing = missingGates(preflight, yaml, pkg.scripts);

  // ASYMMETRY (see module header): ci.yml is fully fail-closed on every `run:` above;
  // security.yml contributes its pnpm SINGLE-LINE gates only — no fail-closed requiredGates
  // (would demand gitleaks/semgrep) and no block-scalar fail-loud (its installers use blocks).
  const securityPath = path.join(repoRoot, '.github/workflows/security.yml');
  if (fs.existsSync(securityPath)) {
    const securityYaml = fs.readFileSync(securityPath, 'utf8');
    const covered = preflightGates(preflight, pkg.scripts);
    for (const gate of requiredPnpmGates(securityYaml, pkg.scripts)) {
      if (!covered.has(gate) && !missing.includes(gate)) missing.push(gate);
    }
  }

  return { ok: missing.length === 0, reason: '', missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verdict = runCheck();
  if (!verdict.ok) {
    const detail =
      verdict.missing.length > 0
        ? `preflight is missing CI gate(s):\n  - ${verdict.missing.join('\n  - ')}\nadd them to the root package.json \`preflight\` script.`
        : verdict.reason;
    console.error(`check-preflight-sync ✗ ${detail}`);
    process.exit(1);
  }
  console.error('check-preflight-sync ✓ preflight covers every local CI gate');
}
