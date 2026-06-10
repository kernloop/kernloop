# skills/ — global skill library

Empty in P0 by design. Skills (progressive-disclosure instruction documents,
spec §3.4) enter only through the `distill` ratification path from P3 onward;
depth ships as skills, never as MCP tool #12.

## Ratification path (P3)

Distill proposes a SKILL.md from an episodic trace and writes it to
`skills/proposed/<name>/`, entering the authority ladder at suggest tier
[CLM-0049]. A proposed skill goes live only when a human moves
`skills/proposed/<name>/` to `skills/<name>/` through a reviewed PR — that
merge is the ratification, and skills enter the procedural library through
no other path [CLM-0050].

Current example in the proposal queue:
`skills/run-quality-gate-via-kernel/ (ratified into the live library by the P3 exit PR merge)`.
