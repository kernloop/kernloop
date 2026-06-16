/**
 * Sandbox error shape tests (#234): callers discriminate on `name`/`instanceof`
 * and read the typed fields, never the message text.
 */
import { describe, expect, it } from 'vitest';
import {
  SandboxMountError,
  SandboxProfileMismatchError,
  SandboxUnavailableError,
} from './errors.js';

describe('sandbox errors', () => {
  it('SandboxUnavailableError names itself and carries the detail in the message', () => {
    const e = new SandboxUnavailableError('docker daemon unreachable');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('SandboxUnavailableError');
    expect(e.message).toContain('docker daemon unreachable');
  });

  it('SandboxProfileMismatchError exposes the expected and actual hashes', () => {
    const e = new SandboxProfileMismatchError('expected-hash', 'actual-hash');
    expect(e.name).toBe('SandboxProfileMismatchError');
    expect(e.expectedHash).toBe('expected-hash');
    expect(e.actualHash).toBe('actual-hash');
    expect(e.message).toContain('actual-hash');
  });

  it('SandboxMountError preserves its message verbatim', () => {
    const e = new SandboxMountError('mount target must be an absolute, colon-free path: /x:rw');
    expect(e.name).toBe('SandboxMountError');
    expect(e.message).toContain('colon-free');
  });
});
