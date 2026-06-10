/**
 * `forge` — tool spec → workshop build report (spec §3.4 forge row, §5.6)
 * [CLM-0058]. The composition root's binding of the toolsmith faculty:
 * generation flows through the loop's one adapter seam under a strict
 * one-JSON-object contract ({"source":"<tool.mjs>"}), the acceptance test
 * runs inside the ratified Docker sandbox (docker absent or profile drift
 * are the toolsmith's typed refusals, surfaced as-is — never degraded), and
 * a successful birth registers the `workshop/*` manifest in the kernel
 * registry + ladder (suggest tier) and appends a `cli.forge.build` audit
 * event with the build provenance (rule 7). Workshop tools NEVER extend the
 * MCP surface — they are manifests under the `workshop/*` namespace, not
 * tool #12 (spec §3.4).
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ADAPTER_NAMES, appendEvent } from '@kernloop/kernel';
import {
  forge,
  RATIFIED_SANDBOX_PROFILE,
  type ForgeResult,
  type InvokeToolGenerator,
  type ToolSpec,
} from '@kernloop/faculty-toolsmith';
import type { Kernloop } from '../kernel.js';
import {
  adapterInvoke,
  ensureAdapterAvailable,
  parseEmission,
  type LoopInvoke,
} from '../loop/invoke.js';

/** Input to the `forge` tool. */
export const ForgeInputSchema = z
  .strictObject({
    /** The birth certificate (claim + acceptance test + manifest), inline… */
    spec: z.unknown().optional(),
    /** …or read from a JSON file (exactly one of the two). */
    specFile: z.string().min(1).optional(),
    /** Adapter the generation call flows through; default claude. */
    adapter: z.enum(ADAPTER_NAMES).default('claude'),
  })
  .refine((v) => (v.spec === undefined) !== (v.specFile === undefined), {
    message: 'provide exactly one of spec or specFile',
  });
export type ForgeInput = z.input<typeof ForgeInputSchema>;

/** The model's raw generation — the strict forge output contract. */
export const SourceEmissionSchema = z.strictObject({
  /** Complete content of the workshop tool's single-file `tool.mjs`. */
  source: z.string().min(1),
});

/** The generation prompt: the full birth certificate + strict contract. */
function generationPrompt(spec: ToolSpec): string {
  return [
    'You are generating ONE dependency-free single-file node ES module (tool.mjs)',
    'for a kernloop workshop tool. It runs in a sandbox with node and NOTHING',
    'else: only node builtins and its own file may be imported.',
    '',
    '## Claim it must satisfy',
    `${spec.claim.id}: ${spec.claim.statement}`,
    '',
    '## Acceptance test it must pass (runs as `node --test test.mjs` beside tool.mjs)',
    spec.acceptanceTest,
    '',
    '## Manifest',
    JSON.stringify(spec.manifest, null, 2),
    '',
    '## Output contract (STRICT)',
    'Respond with ONE raw JSON object and nothing else — no prose, no fences:',
    '{"source":"<the complete tool.mjs content>"}',
  ].join('\n');
}

/** Bind the adapter seam as the toolsmith's injected generator. */
export function generatorInvoker(kern: Kernloop, invoke: LoopInvoke): InvokeToolGenerator {
  return async (spec) => {
    const { output } = await invoke(generationPrompt(spec));
    const sink = {
      overlayDir: kern.paths.dir,
      runId: spec.manifest.name.replace('/', '-'),
      node: 'forge',
    };
    return parseEmission(output, SourceEmissionSchema, 'tool-source', sink).source;
  };
}

/** Injectable seams (tests script them); the defaults are real. */
export interface ForgeToolOptions {
  /** Model seam; default: the chosen kernel adapter, probed up front. */
  invoke?: LoopInvoke;
  /** Docker binary; injectable so refusal/success paths are testable. */
  dockerBin?: string;
}

/** The `forge` tool. See module docs. */
export async function forgeTool(
  kern: Kernloop,
  input: ForgeInput,
  options: ForgeToolOptions = {},
): Promise<ForgeResult> {
  const parsed = ForgeInputSchema.parse(input);
  const spec: unknown = parsed.spec ?? JSON.parse(readFileSync(parsed.specFile as string, 'utf8'));
  // Validate-first (spec §5.6 birth order): adapter availability is a
  // generation-time concern, probed lazily on the first invoke so a birth
  // defect in the spec is reported even where no model CLI exists.
  let invoke = options.invoke;
  if (invoke === undefined) {
    const adapter = parsed.adapter;
    let bound: LoopInvoke | undefined;
    invoke = (prompt, opts) => {
      if (bound === undefined) {
        ensureAdapterAvailable(adapter);
        bound = adapterInvoke(adapter);
      }
      return bound(prompt, opts);
    };
  }
  const result = await forge({
    overlayDir: kern.paths.dir,
    spec,
    invoke: generatorInvoker(kern, invoke),
    profile: RATIFIED_SANDBOX_PROFILE,
    ...(options.dockerBin === undefined ? {} : { dockerBin: options.dockerBin }),
  });
  // A born tool is a registered workshop/* capability at suggest tier
  // (spec §5.6 ladder) — in the registry, never on the MCP surface.
  kern.registry.register(result.manifest);
  kern.ladder.setTier(result.manifest.name, 'observe', result.manifest.tier);
  appendEvent(kern.store, {
    type: 'cli.forge.build',
    payload: {
      name: result.manifest.name,
      version: result.manifest.version,
      dir: result.dir,
      profileHash: result.profileHash,
      generator: `adapter:${parsed.adapter}`,
      tier: result.manifest.tier,
    },
  });
  return result;
}
