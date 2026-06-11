# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue:

- Open a [GitHub security advisory](https://github.com/kernloop/kernloop/security/advisories/new), or
- email the maintainer (see the GitHub profile for `@williamzujkowski`).

Include the affected file/path, a description, and — if you have one — a
proof-of-concept. We aim to acknowledge within a few days. Please do not
disclose publicly until a fix is available.

## Scope and threat model

Kernloop runs AI-generated code and external model CLIs, so its highest-risk
surfaces are deliberate and audited:

- **The Toolsmith cage.** Model-generated `workshop/*` tools are generated and
  executed **only** inside a hash-pinned Docker sandbox — no network, a
  scratch-only filesystem, non-root, resource-capped, time-boxed
  ([CLM-0051]–[CLM-0054]). The cage never falls back to unsandboxed execution.
- **Canonical-loop file writes.** Files a coder model emits are confined to the
  task workspace, guarded against both lexical traversal and symlink escape
  ([CLM-0059]).
- **Subprocess seams.** Adapter, `docker`, and `gh` invocations use array-arg
  `spawn` with `shell: false` — no shell interpretation, no argument injection.
- **The audit chain** is append-only and hash-chained; any tampering fails
  `verifyChain` ([CLM-0009]–[CLM-0013]).

Out of scope: the security of the model providers' own CLIs, and host
compromise originating outside kernloop.

## Automated scanning

The [`Security`](.github/workflows/security.yml) workflow runs on every push
and PR and weekly: secrets (gitleaks), dependency advisories (`pnpm audit`),
and SAST (semgrep `--config auto`). These are **advisory** today — they report
and fail visibly but are not yet in the branch-protection required-checks set,
so a noisy scanner cannot block merges while the baseline is tuned. They are
promoted to required once the baseline is clean and stable.

## How findings are handled

Per [`AGENTS.md`](AGENTS.md), every security finding from a review round is
filed as a labeled (`security`) GitHub issue with file:line and a concrete
fix, and a phase exit PR may not merge with an open `security` finding it
introduced.
