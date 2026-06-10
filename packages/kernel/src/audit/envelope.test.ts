/**
 * Tests for the audit event envelope schema (spec §3.1; seed Step 4: every
 * envelope carries `contractsVersion`).
 */

import { describe, expect, it } from 'vitest';
import { contractsVersion } from '@kernloop/contracts';
import {
  AuditEnvelopeSchema,
  GENESIS_PREV_HASH,
  buildEnvelope,
  computeEnvelopeHash,
} from './envelope.js';

function validEnvelope() {
  return buildEnvelope({
    seq: 1,
    ts: '2026-06-09T00:00:00.000Z',
    type: 'test.event',
    payload: { key: 'value' },
    prevHash: GENESIS_PREV_HASH,
  });
}

describe('GENESIS_PREV_HASH', () => {
  it('is 64 zero hex chars (documented genesis constant)', () => {
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64));
  });
});

describe('buildEnvelope', () => {
  it('stamps contractsVersion from @kernloop/contracts on every envelope', () => {
    expect(validEnvelope().contractsVersion).toBe(contractsVersion);
  });

  it('sets hash to the SHA-256 of the canonical envelope-minus-hash', () => {
    const env = validEnvelope();
    const rest = { ...env } as Partial<typeof env>;
    delete rest.hash;
    expect(env.hash).toBe(computeEnvelopeHash(rest as Omit<typeof env, 'hash'>));
    expect(env.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an empty type', () => {
    expect(() =>
      buildEnvelope({
        seq: 1,
        ts: '2026-06-09T00:00:00.000Z',
        type: '',
        payload: null,
        prevHash: GENESIS_PREV_HASH,
      }),
    ).toThrow();
  });
});

describe('AuditEnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(AuditEnvelopeSchema.safeParse(validEnvelope()).success).toBe(true);
  });

  it('rejects an envelope missing any required field', () => {
    const env = validEnvelope();
    for (const field of Object.keys(env)) {
      const partial: Record<string, unknown> = { ...env };
      delete partial[field];
      expect(AuditEnvelopeSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('rejects unknown extra fields (strict envelope)', () => {
    const env = { ...validEnvelope(), smuggled: true };
    expect(AuditEnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it('rejects a non-integer or non-positive seq', () => {
    expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), seq: 1.5 }).success).toBe(false);
    expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), seq: 0 }).success).toBe(false);
    expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), seq: -1 }).success).toBe(false);
  });

  it('rejects a non-ISO-8601 timestamp', () => {
    expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), ts: 'yesterday' }).success).toBe(
      false,
    );
    expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), ts: 1749427200 }).success).toBe(
      false,
    );
  });

  it('rejects a bad contractsVersion format', () => {
    for (const bad of ['', 'banana', '1.0', 'v1.0.0', '1.0.0-beta']) {
      const env = { ...validEnvelope(), contractsVersion: bad };
      expect(AuditEnvelopeSchema.safeParse(env).success).toBe(false);
    }
  });

  it('rejects malformed hash and prevHash values', () => {
    for (const bad of ['', 'xyz', 'A'.repeat(64), '0'.repeat(63)]) {
      expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), hash: bad }).success).toBe(false);
      expect(AuditEnvelopeSchema.safeParse({ ...validEnvelope(), prevHash: bad }).success).toBe(
        false,
      );
    }
  });

  it('accepts any JSON payload shape, including null and nested structures', () => {
    for (const payload of [null, 'str', 0, false, [1, [2]], { a: { b: [null] } }]) {
      const env = buildEnvelope({
        seq: 1,
        ts: '2026-06-09T00:00:00.000Z',
        type: 'test.event',
        payload,
        prevHash: GENESIS_PREV_HASH,
      });
      expect(AuditEnvelopeSchema.safeParse(env).success).toBe(true);
    }
  });

  it('rejects non-JSON payloads', () => {
    const env = { ...validEnvelope(), payload: undefined };
    expect(AuditEnvelopeSchema.safeParse(env).success).toBe(false);
  });
});
