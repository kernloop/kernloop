/**
 * SIGINT → cooperative-abort wiring (#317, CLM-0144). Exercised with an injected
 * EventEmitter as the `process`, so the operator-facing trigger is HERMETIC — no
 * real OS signals in CI (the flaky surface the #304 vote split out). The abort
 * EFFECT (cancelled Outcome, spend reconciliation, resumability) is CLM-0143's.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { withSigintAbort } from './sigint-abort.js';

describe('withSigintAbort (#317, CLM-0144)', () => {
  it('first SIGINT aborts the signal; the listener is removed after the run settles', async () => {
    const proc = new EventEmitter();
    let forced = 0;
    const aborted = await withSigintAbort(
      proc,
      () => (forced += 1),
      (signal) => {
        proc.emit('SIGINT'); // operator hits Ctrl-C mid-run
        return Promise.resolve(signal.aborted);
      },
    );
    expect(aborted).toBe(true); // the signal fired
    expect(forced).toBe(0); // a single Ctrl-C cooperatively aborts, never force-exits
    expect(proc.listenerCount('SIGINT')).toBe(0); // no handler leak after settle
  });

  it('a SECOND SIGINT escalates to the force-quit — the operator escape hatch', async () => {
    const proc = new EventEmitter();
    let forced = 0;
    await withSigintAbort(
      proc,
      () => (forced += 1),
      (signal) => {
        proc.emit('SIGINT'); // first  → cooperative abort
        proc.emit('SIGINT'); // second → force quit
        expect(signal.aborted).toBe(true); // stays aborted (abort() is idempotent — no double-flush)
        return Promise.resolve();
      },
    );
    expect(forced).toBe(1); // exactly one force-exit on the second Ctrl-C
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });

  it('a run that completes without a SIGINT leaves no listener behind', async () => {
    const proc = new EventEmitter();
    const out = await withSigintAbort(
      proc,
      () => undefined,
      () => Promise.resolve('done'),
    );
    expect(out).toBe('done');
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });

  it('removes the listener even when the wrapped run throws (finally cleanup)', async () => {
    const proc = new EventEmitter();
    await expect(
      withSigintAbort(
        proc,
        () => undefined,
        () => Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });
});
