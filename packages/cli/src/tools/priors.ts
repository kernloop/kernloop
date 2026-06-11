/**
 * `priors export` (spec §7: "learned routing priors, exported, reviewable" —
 * the file is named `priors.yaml`) [CLM-0070]. Reads the Observer fitness
 * ledger's routing-prior-relevant fields and writes them as reviewable YAML
 * to the overlay's `priors.yaml` (or `--out`). Seeding the Router FROM
 * priors.yaml is intentionally OUT OF SCOPE here — this is export and
 * reviewability only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import YAML from 'yaml';
import type { Kernloop } from '../kernel.js';

/** Input to the `priors export` tool. */
export const PriorsExportInputSchema = z.strictObject({
  /** Path to write the YAML to; omitted → the overlay's `priors.yaml`. */
  out: z.string().min(1).optional(),
});
export type PriorsExportInput = z.input<typeof PriorsExportInputSchema>;

/** What `priors export` returns: where it wrote, and how many priors. */
export interface PriorsExportResult {
  written: string;
  priors: number;
}

/** A header comment naming the source, so the file is self-describing. */
const PRIORS_HEADER =
  '# kernloop learned routing priors (spec §7) — exported from the Observer\n' +
  '# fitness ledger [CLM-0070]. Reviewable; router seeding from this file is\n' +
  '# not yet wired. Regenerate with `kernloop priors export`.\n';

/** Export the overlay's routing priors to YAML (CLM-0070). See module docs. */
export function priorsExportTool(
  kern: Kernloop,
  input: PriorsExportInput = {},
): PriorsExportResult {
  const parsed = PriorsExportInputSchema.parse(input);
  const doc = kern.observer.exportPriors();
  const out = parsed.out ?? kern.paths.priors;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, PRIORS_HEADER + YAML.stringify(doc), 'utf8');
  return { written: out, priors: doc.priors.length };
}
