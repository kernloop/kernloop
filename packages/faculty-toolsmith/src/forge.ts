/**
 * Forge — the birth path for workshop tools (spec §5.6; CLM-0051..0053).
 * Hard order, no exceptions: validate first, generate second, sandbox-test
 * third, install fourth. Any missing/invalid birth piece refuses BEFORE any
 * generation or docker call.
 *
 * Workshop tools are dependency-free single-file node scripts by
 * construction: the sandbox image has node and nothing else — no npm
 * install, no node_modules, no network — so any import beyond node builtins
 * and the tool's own files fails its acceptance test physically. That, not a
 * lint, is what enforces "cannot import kernel/faculty internals".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { ManifestSchema, type Manifest } from '@kernloop/contracts';
import {
  ForgeBirthError,
  ForgeTestFailedError,
  SandboxProfileMismatchError,
  WorkshopCapError,
} from './errors.js';
import { registerTool } from './lifecycle.js';
import {
  RATIFIED_PROFILE_HASH,
  RATIFIED_SANDBOX_PROFILE,
  profileHash,
  type SandboxProfile,
} from './profile.js';
import { runInSandbox, type SandboxResult } from './sandbox.js';
import { SAFE_TOOL_NAME, listTools, toolDir } from './workshop.js';

/**
 * The claim entry a tool is born with: a repo claim (CLM-NNNN) or an overlay
 * registry id of the same UPPERCASE-prefix-dash-digits shape, plus its
 * statement.
 */
export const ToolClaimSchema = z.strictObject({
  id: z.string().regex(/^[A-Z][A-Z0-9]*-\d{1,6}$/, 'claim id must look like CLM-0051'),
  statement: z.string().min(1),
});

/**
 * Birth certificate for one workshop tool (spec §5.6: "a tool spec must
 * include a claim entry, an acceptance test, and a manifest BEFORE forge
 * will build it").
 */
export const ToolSpecSchema = z.strictObject({
  claim: ToolClaimSchema,
  /** Source of a node:test file the generated tool must pass in-sandbox. */
  acceptanceTest: z.string().min(1),
  manifest: ManifestSchema,
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

/** The injected generator — the only place a model touches this faculty. */
export type InvokeToolGenerator = (spec: ToolSpec) => Promise<string>;

/** Options for {@link forge}. */
export interface ForgeOptions {
  /** Overlay root (the directory holding `workshop/`). */
  readonly overlayDir: string;
  /** Candidate birth certificate; validated here, never trusted. */
  readonly spec: unknown;
  /** Injected model generation; absence is a birth defect, not a fallback. */
  readonly invoke?: InvokeToolGenerator;
  /** Active sandbox profile; must hash-match the ratified one. */
  readonly profile?: SandboxProfile;
  /** Docker binary; injectable so refusal paths are testable. */
  readonly dockerBin?: string;
  /** Injectable clock (epoch ms). */
  readonly clock?: () => number;
}

/** A successful birth. */
export interface ForgeResult {
  /** Short tool name (directory under workshop/). */
  readonly name: string;
  /** Absolute install directory. */
  readonly dir: string;
  readonly manifest: Manifest;
  /** The sandbox acceptance-test run that earned the install. */
  readonly sandbox: SandboxResult;
  /** Hash of the profile the tool was built under (== RATIFIED_PROFILE_HASH). */
  readonly profileHash: string;
}

/** Validate the spec + manifest constraints; collect every problem. */
function validateBirth(rawSpec: unknown, invoke: InvokeToolGenerator | undefined): ToolSpec {
  const problems: string[] = [];
  const parsed = ToolSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`spec.${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  } else {
    const m = parsed.data.manifest;
    if (m.kind !== 'workshopTool')
      problems.push(`manifest.kind must be 'workshopTool', got '${m.kind}'`);
    if (m.tier !== 'suggest')
      problems.push(`manifest.tier must be 'suggest' at birth, got '${m.tier}'`);
    if (!m.name.startsWith('workshop/')) {
      problems.push(`manifest.name must match /^workshop\\//, got '${m.name}'`);
    } else if (!SAFE_TOOL_NAME.test(m.name.slice('workshop/'.length))) {
      problems.push(`manifest.name segment after workshop/ must match ${String(SAFE_TOOL_NAME)}`);
    }
  }
  if (invoke === undefined) {
    problems.push('invoke: no model generator injected — forge cannot build without one');
  }
  if (problems.length > 0) throw new ForgeBirthError(problems);
  return (parsed as { data: ToolSpec }).data;
}

/** Install the proven tool under the overlay workshop namespace. */
function install(
  overlayDir: string,
  name: string,
  spec: ToolSpec,
  source: string,
  at: number,
): string {
  const dir = toolDir(overlayDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tool.mjs'), source, 'utf8');
  fs.writeFileSync(path.join(dir, 'test.mjs'), spec.acceptanceTest, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(spec.manifest, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'claim.yaml'), YAML.stringify(spec.claim), 'utf8');
  registerTool({ overlayDir, name, at });
  return dir;
}

/**
 * Forge one workshop tool. Order is law: (1) birth validation — claim +
 * acceptance test + manifest (kind workshopTool, tier suggest, workshop/
 * name) + injected invoke, all before any generation or docker call;
 * (2) ratified-profile hash gate; (3) live-tool cap; (4) generation via the
 * injected invoke into a FRESH scratch dir; (5) the acceptance test runs
 * INSIDE the sandbox; (6) only on green does the tool install into
 * `<overlayDir>/workshop/<name>/` with its full birth record. A red test
 * preserves the scratch dir and reports its path (ForgeTestFailedError).
 */
export async function forge(options: ForgeOptions): Promise<ForgeResult> {
  const spec = validateBirth(options.spec, options.invoke);
  const profile = options.profile ?? RATIFIED_SANDBOX_PROFILE;
  const actualHash = profileHash(profile);
  if (actualHash !== RATIFIED_PROFILE_HASH) {
    throw new SandboxProfileMismatchError(RATIFIED_PROFILE_HASH, actualHash);
  }
  if (listTools(options.overlayDir).length >= profile.liveToolCapPerOverlay) {
    throw new WorkshopCapError(profile.liveToolCapPerOverlay);
  }
  const invoke = options.invoke as InvokeToolGenerator;
  const source = await invoke(spec);
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-forge-'));
  // mkdtemp creates 0700 dirs; the sandbox runs as the in-container `node`
  // user, whose uid need not match the host uid (e.g. CI runners). The
  // scratch dir is private temp space, so opening it to the container user
  // is the sandbox-true permission, not a weakening.
  fs.chmodSync(scratchDir, 0o777);
  fs.writeFileSync(path.join(scratchDir, 'tool.mjs'), source, { mode: 0o644 });
  fs.writeFileSync(path.join(scratchDir, 'test.mjs'), spec.acceptanceTest, { mode: 0o644 });
  const sandbox = await runInSandbox({
    scratchDir,
    command: ['node', '--test', 'test.mjs'],
    profile,
    ...(options.dockerBin !== undefined ? { dockerBin: options.dockerBin } : {}),
  });
  if (sandbox.exitCode !== 0 || sandbox.timedOut) {
    throw new ForgeTestFailedError(
      scratchDir,
      sandbox.exitCode,
      sandbox.timedOut,
      sandbox.stdout,
      sandbox.stderr,
    );
  }
  const name = spec.manifest.name.slice('workshop/'.length);
  const at = (options.clock ?? Date.now)();
  const dir = install(options.overlayDir, name, spec, source, at);
  fs.rmSync(scratchDir, { recursive: true, force: true });
  return { name, dir, manifest: spec.manifest, sandbox, profileHash: actualHash };
}
