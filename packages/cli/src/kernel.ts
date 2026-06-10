/**
 * Kernel assembly — the composition root (spec §9 `packages/cli`). Builds
 * the L0 kernel (audit store, event bus, manifest registry, ladder, router)
 * over one overlay (spec §7), opens the memory faculty's database, registers
 * the three P1 faculty manifests, and seeds their ladder tiers.
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
import { qualityGateManifest } from '@kernloop/faculty-gates';
import type { Manifest } from '@kernloop/contracts';
import {
  loadOverlayConfig,
  overlayPaths,
  type OverlayConfig,
  type OverlayPaths,
} from './overlay.js';
import { buildExecutors, type CapabilityExecutor } from './executors.js';

/** The three P1 faculty manifests this root registers (spec §5.1–5.3). */
export const P1_FACULTY_MANIFESTS: readonly Manifest[] = [
  memoryManifest,
  compilerManifest,
  qualityGateManifest,
];

/** The assembled system every tool operates on. */
export interface Kernloop {
  readonly paths: OverlayPaths;
  readonly config: OverlayConfig;
  readonly store: AuditStore;
  readonly bus: EventBus;
  readonly registry: ManifestRegistry;
  readonly ladder: Ladder;
  readonly router: Router;
  readonly memory: Memory;
  /** Capability name → executor, for capabilities `run` can execute. */
  readonly executors: ReadonlyMap<string, CapabilityExecutor>;
  /** Close held resources (the memory database handle). */
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

/**
 * Assemble the kernel + faculties over one overlay. Registers the three P1
 * faculty manifests in the registry (each registration is audited) and
 * seeds their ladder tiers mechanically from the manifest-declared tier.
 */
export function createKernloop(options: CreateKernloopOptions): Kernloop {
  const paths = overlayPaths(options.overlayDir);
  mkdirSync(paths.dir, { recursive: true }); // SQLite needs the directory to exist
  const config = loadOverlayConfig(paths);
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
  const memory = createMemory(
    paths.memory,
    clock === undefined ? {} : { clock: () => clock().getTime() },
  );
  for (const manifest of P1_FACULTY_MANIFESTS) {
    registry.register(manifest);
    seedTier(ladder, manifest);
  }
  const kernloop: Kernloop = {
    paths,
    config,
    store,
    bus,
    registry,
    ladder,
    router,
    memory,
    executors: new Map(),
    close: () => memory.close(),
  };
  // The executor map closes over the assembled system; build it last.
  return { ...kernloop, executors: buildExecutors(kernloop) };
}
