/**
 * Kernel AuditChain (spec §3.1) — public surface of the audit module.
 *
 * Ported by evidence from nexus-agents v1 `src/audit/` (spec §10 item 1);
 * see PORT-NOTES.md in this directory for what was kept, changed, and
 * dropped relative to v1.
 *
 * @module kernel/audit
 */

export {
  canonicalJson,
  sha256Canonical,
  hmacSha256Canonical,
  CanonicalizationError,
  type JsonValue,
  type JsonObject,
} from './canonical.js';
export {
  loadKeyring,
  ensureChainKeyed,
  getEpochKey,
  chainBoundary,
  defaultAuditKeyringPath,
  AuditKeyringError,
  AuditKeyringSchema,
  type AuditKeyring,
} from './keyring.js';
export {
  AuditEnvelopeSchema,
  GENESIS_PREV_HASH,
  computeEnvelopeHash,
  buildEnvelope,
  type AuditEnvelope,
} from './envelope.js';
export { createAuditStore, appendEvent, AuditStoreError, type AuditStore } from './store.js';
export { verifyChain, type VerifyResult, type VerifyFailureReason } from './verify.js';
