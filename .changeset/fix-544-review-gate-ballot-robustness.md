---
'@kernloop/cli': patch
---

Fix (#544): the review gate no longer loses a reviewer's whole ballot to one
decorative unknown key (`level`, `findings_note` — observed live 5 times in a
row), and it now surfaces input truncation as a first-class Verdict finding
instead of prose-only.

- `ReviewEmissionSchema` (`packages/cli/src/loop/seams.ts`) STRIPS unknown
  top-level keys from a reviewer's raw report instead of rejecting the whole
  emission (`z.strictObject` → `z.object`, zod v4's default strip mode) —
  `findings`/`summary` stay strictly validated, so a missing or malformed
  required field still fails loud. Per-finding shape stays strict (no
  evidence yet that reviewers decorate individual findings).
- `parseEmission` (`packages/cli/src/loop/invoke.ts`) now records any
  stripped top-level keys via the existing violation sink
  (`<overlay>/checkpoints/<runId>-<node>-dropped-keys.json`) — tolerating
  decoration is not the same as hiding that part of the model's output was
  ignored.
- `reviewTruncationFinding`/`withReviewTruncationFinding` (`seams.ts`) surface
  an `info`-severity Verdict finding naming what was truncated and by how
  many characters when the review gate's diff/context clamp (#288) cut the
  reviewer's input, wired into both review-gate call sites (`tools/gate.ts`,
  `loop/executors.ts`).
