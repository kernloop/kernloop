/**
 * `kernloop doctor` — validate one overlay (spec §7: "`kernloop init`
 * scaffolds it; `kernloop doctor` validates it"). Four real checks: the
 * overlay directory exists, `overlay.yaml` parses and validates, the audit
 * chain verifies end to end, and the memory database opens. Each check
 * reports what it actually found.
 */
import { existsSync } from 'node:fs';
import { createAuditStore, verifyChain } from '@kernloop/kernel';
import { createMemory } from '@kernloop/faculty-memory';
import { loadOverlayConfig, overlayPaths } from './overlay.js';

/** One doctor check result. */
export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** What `doctor` returns. */
export interface DoctorResult {
  readonly ok: boolean;
  readonly overlayDir: string;
  readonly checks: DoctorCheck[];
}

/** Validate overlay.yaml; absent counts as not-ok (init scaffolds it). */
function checkConfig(paths: ReturnType<typeof overlayPaths>): DoctorCheck {
  if (!existsSync(paths.config)) {
    return { name: 'overlay.yaml', ok: false, detail: 'missing — run `kernloop init`' };
  }
  try {
    const config = loadOverlayConfig(paths);
    return { name: 'overlay.yaml', ok: true, detail: `overlay id "${config.id}"` };
  } catch (error) {
    return {
      name: 'overlay.yaml',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Verify the audit chain; an absent file is a valid chain of length 0. */
function checkAudit(paths: ReturnType<typeof overlayPaths>): DoctorCheck {
  const result = verifyChain(createAuditStore(paths.audit));
  return result.ok
    ? { name: 'audit chain', ok: true, detail: `verified, ${String(result.length)} event(s)` }
    : {
        name: 'audit chain',
        ok: false,
        detail: `${result.reason} at seq ${String(result.seq)}: ${result.detail}`,
      };
}

/** Open (and close) the memory database. */
function checkMemory(paths: ReturnType<typeof overlayPaths>): DoctorCheck {
  try {
    const memory = createMemory(paths.memory);
    const traces = memory.listSummaries({ limit: 1 }).length;
    memory.close();
    return {
      name: 'memory.sqlite',
      ok: true,
      detail: traces > 0 ? 'opens, has traces' : 'opens',
    };
  } catch (error) {
    return {
      name: 'memory.sqlite',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Run every doctor check over the overlay under `repoRoot/.kernloop`. */
export function doctor(overlayDir: string): DoctorResult {
  const paths = overlayPaths(overlayDir);
  if (!existsSync(paths.dir)) {
    return {
      ok: false,
      overlayDir: paths.dir,
      checks: [
        {
          name: 'overlay dir',
          ok: false,
          detail: `${paths.dir} does not exist — run \`kernloop init\``,
        },
      ],
    };
  }
  const checks = [
    { name: 'overlay dir', ok: true, detail: paths.dir },
    checkConfig(paths),
    checkAudit(paths),
    checkMemory(paths),
  ];
  return { ok: checks.every((c) => c.ok), overlayDir: paths.dir, checks };
}
