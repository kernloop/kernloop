/**
 * SIGINT → cooperative-abort trigger (#317·P5, CLM-0144) — the operator-facing
 * entry point for the abort behavior #318 shipped (CLM-0143). The `run` command
 * wraps its loop run in {@link withSigintAbort} so the first Ctrl-C fires the
 * already-tested AbortSignal (the loop halts cleanly at the next node boundary,
 * meter flushed, checkpoint resumable).
 *
 * This module claims only the WIRING — install the handler, fire the signal,
 * remove the handler when the run settles — not the abort EFFECT (CLM-0143).
 */

/** The minimal slice of `process` this needs — so the wiring is hermetically
 * testable with an injected EventEmitter (no real OS signals in CI). */
export interface SigintProc {
  on(event: 'SIGINT', listener: () => void): unknown;
  removeListener(event: 'SIGINT', listener: () => void): unknown;
}

/**
 * Run `fn` with an AbortSignal that fires on the FIRST SIGINT (cooperative abort,
 * #304·#317, CLM-0144). A SECOND SIGINT calls `onForceExit` — the force-quit escape
 * hatch: registering a SIGINT handler otherwise SUPPRESSES Node's default Ctrl-C
 * termination, so without this a stuck run could not be killed (#317 vote). The
 * handler is removed in a `finally` once `fn` settles, so it never leaks across
 * runs or tests, on both the signalled and unsignalled paths. Idempotent:
 * `AbortController.abort()` is a no-op once aborted, so the first Ctrl-C cannot
 * double-fire.
 */
export async function withSigintAbort<T>(
  proc: SigintProc,
  onForceExit: () => void,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onSigint = (): void => {
    if (controller.signal.aborted)
      onForceExit(); // second Ctrl-C → force quit
    else controller.abort(); // first Ctrl-C → cooperative abort
  };
  proc.on('SIGINT', onSigint);
  try {
    return await fn(controller.signal);
  } finally {
    proc.removeListener('SIGINT', onSigint);
  }
}
