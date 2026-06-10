/**
 * @kernloop/kernel — Layer 0 (spec §3).
 *
 * P1 surface: audit chain (P0), event bus, manifest registry, authority
 * ladder (spec §3.1). The router and remaining components land later in
 * P1; absent here by design, not stubbed (constitutional rule 1).
 */

export * from './audit/index.js';
export * from './bus/index.js';
export * from './registry/index.js';
export * from './ladder/index.js';
export * from './adapters/index.js';
