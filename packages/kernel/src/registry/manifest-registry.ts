/**
 * Kernel ManifestRegistry (spec §3.1): register/validate/version manifests —
 * the single source of capability truth [CLM-0015]. The registry stores
 * what was registered and answers lookups; it never loads plugin code
 * ("loader is dumb, registry is law") and holds no intelligence
 * (constitutional rule 4).
 *
 * Semantics:
 *  - `register` zod-validates against ManifestSchema and rejects duplicate
 *    `name@version` registrations with a typed error. Multiple versions of
 *    one name coexist.
 *  - `get(name)` returns the most recently registered version of `name`
 *    (or an exact version when one is given); `list` returns every stored
 *    manifest; `findByCapability` matches on advertised capability names.
 *    All lookups answer from registered manifests only — nothing is
 *    inferred or synthesized.
 *  - `remove` requires an explicit `{ ratifiedBy }`: capability removal
 *    always requires human ratification regardless of fitness score
 *    (spec §3.2). Absent or empty ratifier → typed error.
 *  - Registration and removal both append audit events (constitutional
 *    rule 7): identity fields only, never the full manifest — the chain is
 *    for governance; the registry itself holds the record.
 *
 * @module kernel/registry
 */

import { ManifestSchema, type Manifest } from '@kernloop/contracts';
import { appendEvent, type AuditStore } from '../audit/index.js';

/** Why the registry rejected an operation. */
export type ManifestRegistryErrorCode =
  | 'invalid_manifest'
  | 'duplicate_manifest'
  | 'not_found'
  | 'ratification_required';

/** Typed rejection at the registry boundary [CLM-0015]. */
export class ManifestRegistryError extends Error {
  readonly code: ManifestRegistryErrorCode;
  constructor(code: ManifestRegistryErrorCode, message: string) {
    super(message);
    this.name = 'ManifestRegistryError';
    this.code = code;
  }
}

/** Single source of capability truth. See module docs for semantics. */
export class ManifestRegistry {
  private readonly store: AuditStore;
  /** name → (version → manifest), both in registration order. */
  private readonly byName = new Map<string, Map<string, Manifest>>();

  /** @param store - audit store every registration/removal is appended to */
  constructor(store: AuditStore) {
    this.store = store;
  }

  /**
   * Validate and store a manifest [CLM-0015]. Rejects schema-invalid input
   * (`invalid_manifest`) and an already-registered `name@version`
   * (`duplicate_manifest`). Appends a `kernel.registry.register` audit
   * event. Returns the validated manifest.
   */
  register(candidate: unknown): Manifest {
    const result = ManifestSchema.safeParse(candidate);
    if (!result.success) {
      throw new ManifestRegistryError(
        'invalid_manifest',
        `manifest rejected at registration: ${result.error.message}`,
      );
    }
    const manifest = result.data;
    const versions = this.byName.get(manifest.name) ?? new Map<string, Manifest>();
    if (versions.has(manifest.version)) {
      throw new ManifestRegistryError(
        'duplicate_manifest',
        `${manifest.name}@${manifest.version} is already registered`,
      );
    }
    versions.set(manifest.version, manifest);
    this.byName.set(manifest.name, versions);
    appendEvent(this.store, {
      type: 'kernel.registry.register',
      payload: {
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        tier: manifest.tier,
        maturity: manifest.maturity,
      },
    });
    return manifest;
  }

  /**
   * Look up a manifest by name: the most recently registered version, or
   * the exact `version` when given. Returns undefined when not registered.
   */
  get(name: string, version?: string): Manifest | undefined {
    const versions = this.byName.get(name);
    if (versions === undefined) return undefined;
    if (version !== undefined) return versions.get(version);
    let latest: Manifest | undefined;
    for (const manifest of versions.values()) latest = manifest;
    return latest;
  }

  /** Every registered manifest, all names, all versions. */
  list(): Manifest[] {
    const all: Manifest[] = [];
    for (const versions of this.byName.values()) all.push(...versions.values());
    return all;
  }

  /** Registered manifests advertising a capability with this exact name. */
  findByCapability(capabilityName: string): Manifest[] {
    return this.list().filter((m) => m.capabilities.some((c) => c.name === capabilityName));
  }

  /**
   * Remove one registered `name@version`. Capability removal always
   * requires human ratification (spec §3.2): a non-empty `ratifiedBy` is
   * mandatory (`ratification_required` otherwise). Unknown target →
   * `not_found`. Appends a `kernel.registry.remove` audit event recording
   * the ratifier. Returns the removed manifest.
   */
  remove(name: string, version: string, options: { ratifiedBy: string }): Manifest {
    const ratifiedBy = options?.ratifiedBy;
    if (typeof ratifiedBy !== 'string' || ratifiedBy.length === 0) {
      throw new ManifestRegistryError(
        'ratification_required',
        `removal of ${name}@${version} requires an explicit ratifiedBy (spec §3.2)`,
      );
    }
    const versions = this.byName.get(name);
    const manifest = versions?.get(version);
    if (versions === undefined || manifest === undefined) {
      throw new ManifestRegistryError('not_found', `${name}@${version} is not registered`);
    }
    versions.delete(version);
    if (versions.size === 0) this.byName.delete(name);
    appendEvent(this.store, {
      type: 'kernel.registry.remove',
      payload: { name, version, ratifiedBy },
    });
    return manifest;
  }
}
