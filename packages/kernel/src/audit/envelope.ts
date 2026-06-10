/**
 * AuditChain event envelope (spec §3.1: "Append-only hash-chained event log;
 * `verify` op; SIEM-compatible JSON lines"; seed Step 4: "every audit event
 * envelope carries `contractsVersion`").
 *
 * Each stored line is one self-contained JSON envelope — no external context
 * is needed to interpret a line, which is what makes the log SIEM-shippable.
 *
 * Chain construction:
 *  - `seq` is 1-based and strictly monotonic; a verified chain of length N
 *    has seqs exactly 1..N.
 *  - `prevHash` of envelope k+1 equals `hash` of envelope k; envelope 1
 *    carries {@link GENESIS_PREV_HASH}.
 *  - `hash` = SHA-256 over the canonical serialization (see ./canonical.ts)
 *    of the envelope with its `hash` field removed.
 *
 * @module kernel/audit/envelope
 */

import { z } from 'zod';
import { contractsVersion } from '@kernloop/contracts';
import { sha256Canonical, type JsonValue } from './canonical.js';

/**
 * Documented genesis constant: the `prevHash` of the first envelope in a
 * chain. 64 zero hex chars — syntactically a SHA-256 digest, semantically
 * unproducible by hashing, so no real envelope can be mistaken for genesis.
 */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/** Lowercase-hex SHA-256 digest. */
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars');

/** Semver `major.minor.patch`, matching @kernloop/contracts `contractsVersion`. */
const ContractsVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'contractsVersion must be semver major.minor.patch');

/** Any JSON value; rejects undefined/function/symbol/bigint and non-finite numbers. */
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/**
 * The audit event envelope. All fields are required — an envelope is either
 * complete and hashed or it does not enter the log (constitutional rule 1).
 */
export const AuditEnvelopeSchema = z
  .object({
    /** 1-based, strictly monotonic position in the chain. */
    seq: z.number().int().positive(),
    /** ISO-8601 timestamp with offset (UTC `Z` as written by appendEvent). */
    ts: z.iso.datetime({ offset: true }),
    /** Contracts surface version the writer was built against (seed Step 4). */
    contractsVersion: ContractsVersionSchema,
    /** Event type, e.g. 'kernel.audit.self_test' — dot-namespaced by convention. */
    type: z.string().min(1),
    /** Arbitrary JSON payload; hashed as part of the envelope. */
    payload: JsonValueSchema,
    /** `hash` of the previous envelope, or GENESIS_PREV_HASH at seq 1. */
    prevHash: Sha256HexSchema,
    /** SHA-256 over the canonical envelope-minus-hash. */
    hash: Sha256HexSchema,
  })
  .strict();

export type AuditEnvelope = z.infer<typeof AuditEnvelopeSchema>;

/**
 * Compute the chain hash of an envelope: SHA-256 over the canonical
 * serialization of every field except `hash` itself.
 */
export function computeEnvelopeHash(envelope: Omit<AuditEnvelope, 'hash'>): string {
  return sha256Canonical({
    seq: envelope.seq,
    ts: envelope.ts,
    contractsVersion: envelope.contractsVersion,
    type: envelope.type,
    payload: envelope.payload,
    prevHash: envelope.prevHash,
  });
}

/**
 * Build a fully-hashed envelope for the next chain position. Pure — does no
 * I/O; `appendEvent` persists the result.
 */
export function buildEnvelope(input: {
  seq: number;
  ts: string;
  type: string;
  payload: JsonValue;
  prevHash: string;
}): AuditEnvelope {
  const unhashed = {
    seq: input.seq,
    ts: input.ts,
    contractsVersion,
    type: input.type,
    payload: input.payload,
    prevHash: input.prevHash,
  };
  return AuditEnvelopeSchema.parse({ ...unhashed, hash: computeEnvelopeHash(unhashed) });
}
