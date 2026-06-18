/**
 * Loop finalize helpers, split from index.ts for line-count headroom: the
 * agentic-cwd containment guard (#280 pt2), the cooperative-abort remap (#304),
 * and the RunResult→LoopReport mapping. Pure relocation — identical behavior.
 *
 * @module cli/loop/finalize
 */
import {
  appendEvent,
  checkAgenticContainment,
  AgenticRepositoryWorkspaceError,
  type AdapterName,
} from '@kernloop/kernel';
import { type RunResult } from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { type RunTotals } from './invoke.js';
import { type DocArtifactResult } from './doc-artifact.js';
import type { LoopReport, LoopRequest } from './index.js';

/**
 * Agentic-cwd containment on the loop path (#280 pt2, CLM-0145): on a REAL
 * adapter run (an injected/test invoke has no kernel adapter), refuse + AUDIT
 * before any node executes when the workspace is a non-throwaway git tree. The
 * kernel `invokeAdapter` guard is the bypass-backstop; this is the audited,
 * early refusal on the loop path (which holds the store).
 */
export function guardWorkspaceContainment(
  kern: Kernloop,
  adapter: AdapterName,
  request: LoopRequest,
  runId: string,
  tmpRoot?: string,
): void {
  if (request.invoke !== undefined) return;
  try {
    checkAgenticContainment(adapter, request.workspaceDir, tmpRoot);
  } catch (error) {
    if (error instanceof AgenticRepositoryWorkspaceError) {
      appendEvent(kern.store, {
        type: 'cli.adapter.refused',
        payload: { adapter, workspace: error.workspace, reason: 'agentic-cwd-in-git-tree', runId },
      });
    }
    throw error;
  }
}

/**
 * Cooperative abort (#304): the engine returns a `failed` result whose error is
 * `aborted` when the signal fired at a node boundary. Remap it to a CLEAN,
 * resumable halt — status `escalated` (the checkpoint is intact), the dirty
 * `error` dropped — so the run is reported as a cancel carrying the spend-so-far,
 * not a failure. Any other result passes through unchanged.
 */
export function cleanHalt(raw: RunResult): { result: RunResult; aborted: boolean } {
  if (!(raw.status === 'failed' && raw.error?.code === 'aborted'))
    return { result: raw, aborted: false };
  return {
    aborted: true,
    result: {
      runId: raw.runId,
      status: 'escalated',
      nodeTrace: raw.nodeTrace,
      ...(raw.findings === undefined ? {} : { findings: raw.findings }),
      ...(raw.childSpend === undefined ? {} : { childSpend: raw.childSpend }),
    },
  };
}

/** Map the engine's RunResult into the report the run tool returns. */
export function report(
  result: RunResult,
  totals: RunTotals,
  unlimited: boolean,
  docArtifact: DocArtifactResult | undefined,
  haltReason?: string,
): LoopReport {
  return {
    runId: result.runId,
    status: result.status,
    ...(haltReason === undefined ? {} : { haltReason }),
    nodeTrace: result.nodeTrace,
    cost: {
      tokens: totals.tokens,
      usd: totals.usd,
      ...(totals.byAdapter === undefined ? {} : { byAdapter: totals.byAdapter }),
    },
    unlimited,
    ...(result.childSpend === undefined ? {} : { childSpend: result.childSpend }),
    ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
    ...(result.findings === undefined ? {} : { findings: result.findings }),
    ...(result.error === undefined
      ? {}
      : { error: { code: result.error.code, message: result.error.message } }),
    ...(docArtifact === undefined ? {} : { docArtifact }),
  };
}
