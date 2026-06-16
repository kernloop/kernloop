/**
 * The Docker sandbox primitive now lives in the kernel (the shared substrate)
 * so faculty-gates can reuse it for the quality gate (#227 item 2) without a
 * faculty→faculty import (rule 5). This module re-exports it unchanged so the
 * toolsmith's own consumers (forge, run, lifecycle) keep importing it from
 * here. The toolsmith's ratified, hash-gated `RATIFIED_SANDBOX_PROFILE` (with
 * its governance fields) stays in `./profile.js` — only the generic execution
 * primitive moved; the 6-1 ratification is not reopened (#234).
 *
 * @module faculty-toolsmith/sandbox
 */
export {
  buildDockerArgs,
  runInSandbox,
  type SandboxMount,
  type SandboxResult,
  type SandboxRunOptions,
} from '@kernloop/kernel';
