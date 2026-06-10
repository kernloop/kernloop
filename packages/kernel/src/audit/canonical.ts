/**
 * Deterministic canonical JSON serialization + envelope hashing for the
 * AuditChain (spec §3.1). The hash of an audit envelope is SHA-256 over the
 * canonical serialization of the envelope minus its `hash` field, so any
 * mutation of any hashed field — including deep payload edits — changes the
 * hash and is caught by `verifyChain`.
 *
 * Canonical form (documented contract):
 *  - Object keys are sorted lexicographically by UTF-16 code unit
 *    (`Array.prototype.sort` default), recursively at every depth.
 *  - Arrays preserve element order.
 *  - Scalars serialize exactly as `JSON.stringify` serializes them
 *    (strings escaped per JSON, numbers in ES number-to-string form).
 *  - No insignificant whitespace.
 *  - Only JSON values are accepted: `undefined`, functions, symbols, bigints,
 *    and non-finite numbers throw. There is no `toJSON` coercion — the value
 *    hashed is the value stored.
 *
 * This is a deliberate subset of RFC 8785 (JCS): for the value domain the
 * audit chain accepts (parsed-JSON envelopes), key-sorted JSON.stringify is
 * canonical and round-trip stable through JSON.parse.
 *
 * @module kernel/audit/canonical
 */

import { createHash } from 'node:crypto';

/** Any value representable in JSON. Payloads and envelopes are JsonValue. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object (string keys, JsonValue values). */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Thrown when a value outside the JSON domain is offered for hashing/storage. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function canonicalScalar(value: string | number | boolean | null): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CanonicalizationError('non-finite number is not a JSON value');
  }
  return JSON.stringify(value);
}

/**
 * Serialize a JSON value deterministically: identical values produce
 * byte-identical output regardless of object key insertion order.
 *
 * @throws CanonicalizationError for non-JSON values (undefined, function,
 *   symbol, bigint, NaN/Infinity).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return canonicalScalar(value);
  }
  if (typeof value === 'number') {
    return canonicalScalar(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) {
          throw new CanonicalizationError(`undefined property '${k}' is not a JSON value`);
        }
        return JSON.stringify(k) + ':' + canonicalJson(v);
      });
    return '{' + entries.join(',') + '}';
  }
  throw new CanonicalizationError(`value of type ${typeof value} is not a JSON value`);
}

/** Lowercase-hex SHA-256 of the canonical serialization of a JSON value. */
export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
