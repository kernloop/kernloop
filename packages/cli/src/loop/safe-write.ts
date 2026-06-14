/**
 * Symlink-safe file write [CLM-0059] — the workspace boundary defence for files
 * whose CONTENT is model-controlled. `path.resolve` + a realpath check on the
 * parent directory cannot stop a symlink AT the target leaf from redirecting a
 * write outside the workspace (a pre-existing `<ws>/foo -> ~/.ssh/…` follows on
 * `writeFileSync`). Opening with `O_NOFOLLOW` refuses to follow that final
 * symlink ATOMICALLY (TOCTOU-resistant), so a model emission can never overwrite
 * a file outside its sandbox through a planted/committed symlink (#161).
 */
import { closeSync, constants, openSync, writeFileSync } from 'node:fs';

/** A typed refusal: the write target is (or became) a symlink, so following it
 * would escape the workspace — the caller decides whether that is a contract
 * violation (retry) or a best-effort skip (degrade). */
export class SymlinkWriteError extends Error {
  readonly code = 'symlink_write';
  constructor(target: string) {
    super(`refusing to write through a symlink: ${target}`);
    this.name = 'SymlinkWriteError';
  }
}

/**
 * Write `content` to `target`, REFUSING to follow a symlink at the leaf
 * (`O_NOFOLLOW`). Throws {@link SymlinkWriteError} when `target` is a symlink;
 * any other open/write error propagates unchanged.
 */
export function writeFileNoFollow(target: string, content: string): void {
  let fd: number;
  try {
    fd = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o644,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new SymlinkWriteError(target);
    throw error;
  }
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}
