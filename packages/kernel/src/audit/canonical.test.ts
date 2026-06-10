/**
 * Tests for the documented canonical serialization (spec §3.1 hashing
 * substrate): determinism under key reordering, JSON-domain enforcement.
 */

import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalJson, sha256Canonical } from './canonical.js';

describe('canonicalJson', () => {
  it('sorts object keys so insertion order does not change the serialization', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively at every depth', () => {
    const x = { outer: { z: [{ b: 1, a: 1 }], a: true }, alpha: null };
    const y = { alpha: null, outer: { a: true, z: [{ a: 1, b: 1 }] } };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
  });

  it('preserves array element order', () => {
    expect(canonicalJson([1, 2])).toBe('[1,2]');
    expect(canonicalJson([2, 1])).toBe('[2,1]');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('serializes scalars exactly as JSON.stringify does', () => {
    expect(canonicalJson('a "quoted" string\n')).toBe(JSON.stringify('a "quoted" string\n'));
    expect(canonicalJson(0.1)).toBe('0.1');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
  });

  it('produces output that round-trips through JSON.parse', () => {
    const value = { a: [1, 'two', { c: false, b: null }], d: 'e' };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  it('rejects undefined, functions, symbols, and bigints', () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalizationError);
    expect(() => canonicalJson(() => 1)).toThrow(CanonicalizationError);
    expect(() => canonicalJson(Symbol('x'))).toThrow(CanonicalizationError);
    expect(() => canonicalJson(1n)).toThrow(CanonicalizationError);
  });

  it('rejects undefined-valued object properties (no silent omission)', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(CanonicalizationError);
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalJson(Infinity)).toThrow(CanonicalizationError);
  });
});

describe('sha256Canonical', () => {
  it('hashes equal values to equal digests regardless of key order', () => {
    expect(sha256Canonical({ b: [1], a: 'x' })).toBe(sha256Canonical({ a: 'x', b: [1] }));
  });

  it('changes the digest when any nested value changes', () => {
    expect(sha256Canonical({ a: { b: 1 } })).not.toBe(sha256Canonical({ a: { b: 2 } }));
  });

  it('matches a known SHA-256 vector', () => {
    // sha256('{}') — independently checkable: printf '{}' | sha256sum
    expect(sha256Canonical({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });
});
