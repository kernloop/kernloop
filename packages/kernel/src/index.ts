/**
 * @kernloop/kernel — Layer 0 (spec §3).
 *
 * P0 surface: the AuditChain only (append-only, hash-chained, SIEM-compatible
 * JSONL event log with tamper-evident verification — spec §3.1, §3.3, §10
 * item 1). Registry, router, ladder, bus, and adapters land in P1; absent
 * here by design, not stubbed (constitutional rule 1).
 */

export * from './audit/index.js';
