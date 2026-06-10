# claims/ — the kernloop claims registry

The registry IS the backlog (spec §1 rule 2). A capability exists when its
claim's evidence resolves under `claims:check`, and not before. Documentation
cannot lie about behavior: every capability sentence in README.md /
ARCHITECTURE.md must carry a `[CLM-NNNN]` tag pointing here.

## Registry format

One YAML file per claim at `claims/registry/CLM-NNNN.yaml`; the filename must
equal the claim `id`.

```yaml
id: CLM-0042
statement: One README-quotable sentence about verified behavior.
evidence:
  - 'test:packages/foo/src/bar.test.ts::exact test name'
  - 'ci:test'
status: verified # or experimental
owner: williamzujkowski
since: 0.1.0
```

Fields (`claims/src/schema.ts` is authoritative):

- `id` — stable, `CLM-` + four digits
- `statement` — one sentence, single line, terminal punctuation
- `evidence` — non-empty array of typed refs (grammar below)
- `status` — `verified` requires at least one `test` evidence ref
- `owner` — github handle
- `since` — semver of the release the claim has held since

## Evidence ref grammar

| Form                       | Resolves when                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `test:<path>::<test name>` | file exists and contains `test('name')`/`it('name')` with that exact string literal |
| `ci:<job>`                 | a job with that key or display name exists in `.github/workflows/*.yml`             |
| `doc:<path>#<anchor>`      | file exists and contains the anchor (GitHub-slugged heading or explicit `<a id=…>`) |
| `eval:<artifact path>`     | the artifact file exists                                                            |

Template-literal test names are deliberately unresolvable — a name the checker
cannot read statically is not evidence. `claims:check` verifies test
EXISTENCE; CI orders the gate after the test job, so a green gate implies the
referenced tests also ran green.

## Adding a claim

1. Write the acceptance test first (claims-first development).
2. Add `claims/registry/CLM-NNNN.yaml` with the next free id.
3. Run `pnpm claims:check` from the repo root; it must exit 0.
4. Tag the capability sentence in the docs with `[CLM-NNNN]` inside a
   `<!-- claims:begin --> … <!-- claims:end -->` block.
5. `claims/**` is a protected path: changes merge only via PR with human
   review.

## What `claims:check` enforces

`pnpm claims:check` (→ `tsx claims/src/check.ts`) exits 1 when:

- a registry file fails schema validation, ids are duplicated, or a filename
  does not equal its claim id;
- any evidence ref does not resolve (per the grammar above);
- a claim is `verified` with zero test evidence;
- a sentence inside a claims block in README.md / ARCHITECTURE.md lacks a
  `[CLM-NNNN]` tag, any tag references a claim that does not exist, or
  README.md exists without a claims block (absent files are OK in P0;
  ARCHITECTURE.md without markers is OK).

On success it prints the summary table: id → statement → evidence count.
Deliberate-failure proofs for every failure class live in
`claims/src/check.test.ts` and `claims/src/lint.test.ts`.
