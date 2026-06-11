# skills/ — global skill library

Skills are progressive-disclosure instruction documents (spec §3.4): depth
ships as skills, never as MCP tool #12. They enter the procedural library
only through the `distill` ratification path (below).

## Ratification path

<!-- claims:begin -->

Distill proposes a skill document from an episodic trace and writes it to the proposed area, entering the authority ladder at suggest tier [CLM-0049].
A proposed skill goes live only through the distill ratification path — a human-reviewed move from proposed to live, and through no other path [CLM-0050].

<!-- claims:end -->

Concretely: `distill` writes to `skills/proposed/<name>/`; a human moves
`skills/proposed/<name>/` to `skills/<name>/` through a reviewed PR, and that
merge is the ratification. No runtime code path writes into the live library.

Current live example: `skills/run-quality-gate-via-kernel/`, distilled from
the trace of kernloop's first self-run and ratified by the P3 exit PR.
