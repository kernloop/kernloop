/**
 * Kernel assembly — the composition root (spec §9 `packages/cli`). Builds
 * the L0 kernel (audit store, event bus, manifest registry, ladder, router)
 * over one overlay (spec §7), opens the memory faculty's database, opens the
 * observer over the same overlay database (spec §3.3: one DB per overlay;
 * spec §5.5 — every Outcome and gate Verdict the acting tools produce is
 * ingested into its fitness ledger and voter series), registers the P1–P3
 * faculty manifests, and seeds their ladder tiers.
 *
 * Tier seeding is MECHANICAL, not a ratified promotion: each faculty enters
 * the ladder at its manifest-declared tier (memory `suggest`, quality gate
 * `advisory`, both below `enforce` — so no ratification is required by the
 * ladder, per spec §3.2 only promotion to `enforce` needs a human). The
 * compiler manifest declares `observe`, which IS the ladder floor — no
 * transition is recorded for it. Every seed transition is audited like any
 * other tier change [CLM-0017 semantics, kernel-side].
 *
 * The CLI is the composition root: it may import the kernel and every
 * faculty. Faculties still never import each other (constitutional rule 5);
 * cross-faculty data flows through this root as contracts.
 */
import { mkdirSync } from 'node:fs';
import {
  EventBus,
  Ladder,
  ManifestRegistry,
  Router,
  createAuditStore,
  type AuditStore,
} from '@kernloop/kernel';
import { createMemory, memoryManifest, type Memory } from '@kernloop/faculty-memory';
import { compilerManifest } from '@kernloop/faculty-compiler';
import { qualityGateManifest, reviewGateManifest, voteGateManifest } from '@kernloop/faculty-gates';
import { createObserver, observerManifest, type Observer } from '@kernloop/faculty-observer';
import { toolsmithManifest } from '@kernloop/faculty-toolsmith';
import { workflowsManifest } from '@kernloop/workflows';
import type { Manifest } from '@kernloop/contracts';
import { loadOverlay, overlayPaths, type Overlay, type OverlayPaths } from './overlay.js';
import { buildExecutors, type CapabilityExecutor } from './executors.js';
import { createJobStore, type JobStore } from './jobs.js';

/** The three P1 faculty manifests this root registers (spec §5.1–5.3). */
export const P1_FACULTY_MANIFESTS: readonly Manifest[] = [
  memoryManifest,
  compilerManifest,
  qualityGateManifest,
];

/** The P2 manifests: the vote gate (spec §5.3, tier `advisory`) and the
 * canonical loop engine (spec §6, tier `suggest`) [CLM-0046]. */
export const P2_MANIFESTS: readonly Manifest[] = [voteGateManifest, workflowsManifest];

/** The P3 manifests: the review gate (spec §5.3, tier `advisory`), the
 * observer (spec §5.5, tier `suggest`), and the toolsmith (spec §5.6, tier
 * `suggest`). */
export const P3_MANIFESTS: readonly Manifest[] = [
  reviewGateManifest,
  observerManifest,
  toolsmithManifest,
];

/** The assembled system every tool operates on. */
export interface Kernloop {
  readonly paths: OverlayPaths;
  readonly config: Overlay;
  readonly store: AuditStore;
  readonly bus: EventBus;
  readonly registry: ManifestRegistry;
  readonly ladder: Ladder;
  readonly router: Router;
  readonly memory: Memory;
  /** The observer faculty over the same overlay database file (spec §3.3,
   * §5.5) — table-prefix ownership keeps it out of memory's tables. */
  readonly observer: Observer;
  /** The persisted job registry (spec §3.4) — every run is recorded here so
   * `status --job` inspects any run cross-session, and `run --async` returns
   * a job id immediately. File-backed, so a fresh handle resolves prior jobs. */
  readonly jobs: JobStore;
  /** Capability name → executor, for capabilities `run` can execute. */
  readonly executors: ReadonlyMap<string, CapabilityExecutor>;
  /** Close held resources (the memory, observer, and job-registry handles). */
  close(): void;
}

/** Options for {@link createKernloop}. */
export interface CreateKernloopOptions {
  /** Path to the `.kernloop/` overlay directory. */
  overlayDir: string;
  /** Injectable clock for audit envelopes and memory timestamps (tests). */
  clock?: () => Date;
  /** Injectable rng for the router's exploration floor (tests). */
  rng?: () => number;
}

/** Seed the ladder with a manifest's declared tier (see module docs). */
function seedTier(ladder: Ladder, manifest: Manifest): void {
  if (manifest.tier === 'observe') return; // observe is the ladder floor — nothing to record
  ladder.setTier(manifest.name, 'observe', manifest.tier);
}

/** The faculties' epoch-ms clock option, derived from the optional Date clock. */
function msClockOption(clock: (() => Date) | undefined): { clock?: () => number } {
  return clock === undefined ? {} : { clock: () => clock().getTime() };
}

/** Register every faculty manifest (audited) and seed its ladder tier. */
function registerFaculties(registry: ManifestRegistry, ladder: Ladder): void {
  for (const manifest of [...P1_FACULTY_MANIFESTS, ...P2_MANIFESTS, ...P3_MANIFESTS]) {
    registry.register(manifest);
    seedTier(ladder, manifest);
  }
}

/**
 * Assemble the kernel + faculties over one overlay. Registers the three P1
 * faculty manifests in the registry (each registration is audited) and
 * seeds their ladder tiers mechanically from the manifest-declared tier.
 */
export function createKernloop(options: CreateKernloopOptions): Kernloop {
  const paths = overlayPaths(options.overlayDir);
  mkdirSync(paths.dir, { recursive: true }); // SQLite needs the directory to exist
  const config = loadOverlay(paths.dir);
  const clock = options.clock;
  const store = createAuditStore(paths.audit, clock === undefined ? undefined : { clock });
  const bus = new EventBus(store);
  const registry = new ManifestRegistry(store);
  const ladder = new Ladder(store);
  const router = new Router(
    options.rng === undefined
      ? { registry, ladder, store }
      : { registry, ladder, store, rng: options.rng },
  );
  const memory = createMemory(paths.memory, msClockOption(clock));
  // Observer shares the overlay DB file; `observer_*` table prefix is the
  // ownership boundary (proven safe in faculty-observer's store tests).
  const observer = createObserver(paths.memory, msClockOption(clock));
  // The job registry is its own SQLite file in the overlay dir (spec §3.4):
  // every run is recorded here, so status resolves a job id cross-session.
  const jobs = createJobStore(paths.jobs, msClockOption(clock));
  registerFaculties(registry, ladder);
  const kernloop: Kernloop = {
    paths,
    config,
    store,
    bus,
    registry,
    ladder,
    router,
    memory,
    observer,
    jobs,
    executors: new Map(),
    close: () => {
      memory.close();
      observer.close();
      jobs.close();
    },
  };
  // The executor map closes over the assembled system; build it last.
  return { ...kernloop, executors: buildExecutors(kernloop) };
}
