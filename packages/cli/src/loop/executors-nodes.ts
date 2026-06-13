/**
 * The child fan-out node executors (spec §6 decompose → implement → integrate),
 * split out of executors.ts for line-count headroom (#58). Pure relocation:
 * each builder takes the same {@link LoopBindings} and produces the identical
 * NodeExecutor it did when defined inline. `sinkFor` and `writeWorkspaceFiles`
 * are imported from their home in executors.ts so there is one definition.
 */
import { OutcomeSchema, TaskContractSchema } from '@kernloop/contracts';
import { decomposePlan, type SubtaskSpec } from '@kernloop/faculty-workforce';
import type { ChildResult, NodeExecutor } from '@kernloop/workflows';
import { FilesEmissionSchema, SubtasksEmissionSchema, parseEmission } from './invoke.js';
import { briefText } from './seams.js';
import { coderPrompt, decomposePrompt } from './prompts.js';
import { childSignal, sumChildCosts } from './aggregate.js';
import { identityRef, servedRef } from './node-seam.js';
import { sinkFor, writeWorkspaceFiles, type LoopBindings } from './executors.js';

/** The decompose node: PM via invoke, then the MECHANICAL budget invariant. */
export function decomposeExecutor(b: LoopBindings): NodeExecutor {
  return async (_input, ctx) => {
    const parent = b.refs.framedTask;
    const plan = b.refs.planBrief;
    if (parent === undefined || plan === undefined) {
      throw new Error(`decompose reached without framed task + plan (run ${ctx.runId})`);
    }
    const { output } = await b
      .invokeFor('decompose')
      .invoke(decomposePrompt(parent, briefText(plan)));
    const sink = sinkFor(b, ctx.runId, 'decompose');
    const emission = parseEmission(output, SubtasksEmissionSchema, 'subtasks', sink);
    return decomposePlan({ parent, subtasks: emission.subtasks as SubtaskSpec[] });
  };
}

/** The implement child node: coder via invoke → files written for real.
 * On a re-iteration `ctx.findings` carries THIS child's accumulated gate
 * findings (the engine scopes findings to the child inside the fan-out); they
 * fold into the coder prompt so the re-run fixes every failed check [CLM-0043]. */
export function implementExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const child = TaskContractSchema.parse(input);
    const seam = b.invokeFor('implement');
    const { output, cost } = await seam.invoke(coderPrompt(child, ctx.findings));
    const sink = sinkFor(b, ctx.runId, `implement-${child.id}`);
    const emission = parseEmission(output, FilesEmissionSchema, 'files', sink);
    const written = writeWorkspaceFiles(b.workspaceDir, emission.files);
    // Stash what this child wrote so the advisory review gate can diff it.
    (b.refs.writtenByChild ??= {})[child.id] = emission.files;
    const notes = emission.notes === '' ? '' : ` — ${emission.notes}`;
    return OutcomeSchema.parse({
      taskId: child.id,
      status: 'success',
      signals: [
        {
          name: 'implement',
          passed: true,
          // Provenance names the model+effort that truly served (degradation
          // recorded) AND the normalized model class behind the served alias
          // [CLM-0081], so the trace never implies more than ran [CLM-0078].
          detail: `[${servedRef(seam.served)} ${identityRef(seam.served, b.discovered)}] wrote ${String(written.length)} file(s): ${written.join(', ')}${notes}`,
        },
      ],
      cost,
      traceRef: `loop:${ctx.runId}#child=${child.id}`,
      distillCandidates: [],
    });
  };
}

/** The integrate node: success only if every child implemented AND passed quality. */
export function integrateExecutor(): NodeExecutor {
  return (input, ctx) => {
    const results = input as readonly ChildResult[];
    const signals = results.map((result) => childSignal(result));
    const succeeded = signals.length > 0 && signals.every((signal) => signal.passed);
    return Promise.resolve(
      OutcomeSchema.parse({
        taskId: ctx.taskId,
        status: succeeded ? 'success' : 'failure',
        signals,
        cost: sumChildCosts(results),
        traceRef: `loop:${ctx.runId}`,
        distillCandidates: [],
      }),
    );
  };
}
