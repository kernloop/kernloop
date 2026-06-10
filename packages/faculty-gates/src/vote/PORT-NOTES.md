# Vote gate — v1 port notes (quarry item 3, spec §10)

Source quarried (read-only): `nexus-substrate/nexus-agents`
`packages/nexus-agents/src/cli/voter-prompts.ts`, `cli/vote-types.ts`,
`consensus/strategies.ts`, `consensus/types-core.ts`,
`mcp/tools/consensus-vote.ts`. Reimplemented against kernloop contracts;
no v1 code imported.

## Ported

**Role prompts (as data, `voters.ts`).** All seven v1 voter roles:
architect, security, devex, ai_ml → `ai-ml`, pm, catfish → `contrarian`
(kernloop names the role by its function), scope_steward →
`scope-steward`. Each prompt keeps its v1 evaluation criteria, the
workflow-test assessment footer, and the rejection-category taxonomy
(YAGNI, DRY_VIOLATION, …). The scope-steward's five mandatory checks and
default-don't-ship posture are kept; its few-shot Rufus rejection example
was condensed into the originating-case paragraph.

**Panel compositions.** 7-voter ratification panel = v1's full panel.
3-voter default panel = v1's quickMode panel `[architect, security,
scope_steward]` — v1 deliberately substituted scope_steward for pm
(2026-04-25, after a panel approved building a USB flasher that Rufus
already solved) so fast triage still covers existence-justification. That
reasoning holds here: the cheap panel covers structure, risk, and
"should this exist at all".

**Strategies in use (`strategies.ts`, spec §12.3 item 3).**
`simple_majority` (strict > 1/2 of non-abstain; tie rejects),
`supermajority` (inclusive ≥ 2/3 of non-abstain), `unanimous` (zero
rejections, ≥1 approval; abstentions allowed but cannot carry alone).
Abstentions are excluded from the denominator, as in v1.

## Deltas (kernloop ≠ v1)

- **Prompts are static data.** v1 interpolated a project name
  (`getVoterPrompts(project)`); kernloop voters get task/project context
  from the one shared compiled Brief (CLM-0039), so prompts say "the
  project described in your brief".
- **No response-format / JSON-parsing machinery.** v1's
  `buildVotePrompt`, `VoteResponseSchema`, and JSON extraction belong to
  the model boundary; in kernloop that boundary is the injected
  `invokeVoter` owned by the composition root (faculty stays model-free).
- **No PR-review-mode addendum.** That is review-gate machinery; the
  review gate is P3 and stays in the quarry.
- **Supermajority threshold is the exact rational 2/3**, compared without
  floating point. v1 used `>= 0.67`, which 2-of-3 (0.6667) narrowly
  misses; kernloop's 2-of-3 approves, per spec §5.3 "super-majority".
- **All-abstain panel → result `abstain`** (confidence 0). v1 returned a
  generic "rejected: no votes cast"; the kernloop Verdict result enum has
  an honest `abstain`.
- **Voter failure → recorded `abstain`** with `voter_error: …` reasoning
  (v1's error-vote path, same semantics, no retry/timeout machinery — the
  injected `invokeVoter` owns retries, timeouts, and rate limiting).
- **No stagger/deadline machinery.** v1's inter-agent delays, overall
  deadlines, diverse-CLI round-robin, and Codex concurrency warnings live
  with the adapters; voters here run via a plain `Promise.all`.

## Stayed in the quarry

`proof_of_learning`, `opinion_wise`/`higher_order` (weighted/Bayesian)
strategies; weighted vote counts; quorum/incremental-quorum machinery;
agreement-cascade and correlation tracking; quickMode escalation gates;
vote hashing (kernloop audits Verdicts kernel-side at the bus boundary);
simulation fallback (a simulated vote is a fabricated vote). Each returns
only via a claim (spec §1: second-system restraint).
