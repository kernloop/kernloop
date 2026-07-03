---
'@kernloop/docscan': patch
'@kernloop/faculty-gates': patch
'@kernloop/workflows': patch
'@kernloop/cli': patch
---

fix(loop): make the child quality gate convergeable (#534, #535). The canonical
loop's child quality gate now scopes the doc-comment check to the child's OWN
written files (mirroring diff-coverage), so a pre-existing repo-wide doc gap can
no longer fail every child; the standalone whole-workspace `gate quality`
semantics are unchanged when no scope is passed. [CLM-0189] And the child
iteration back-edge deduplicates findings on append at all three fold sites
(reiterate, escalate, hint-fold), so a gate re-emitting the same still-unfixed
findings no longer inflates the accumulated set or the audited findingCount
(the June-13 113→221→329 stack); genuinely new findings still accumulate as
coder hints. [CLM-0190]
