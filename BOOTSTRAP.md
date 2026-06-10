# BOOTSTRAP.md — Kernloop identity bootstrap

Exact, copy-pasteable steps. Items marked **HUMAN** require accounts/credentials
only the human holds (npm, registrar). Items marked **DONE (agent)** were
executed or verified by the bootstrap agent with the granted `gh` admin rights.

## 1. GitHub org + repo — DONE (agent: verified)

Org `kernloop` and repo `kernloop/kernloop` (public) already exist with
`origin` set. Fallback names if the org had been sniped: `kernloop-dev`,
`getkernloop`. To verify:

```bash
gh repo view kernloop/kernloop --json name,visibility,defaultBranchRef
```

## 2. npm scope claim — DONE (human, 2026-06-10)

npm org `kernloop` created (owns the `@kernloop/*` scope);
`@kernloop/contracts@0.0.0` and unscoped `kernloop@0.0.0` placeholders
published. Verify: `npm view @kernloop/contracts version && npm view
kernloop version` → `0.0.0`. Original instructions kept below for the
record. Real packages publish over these as `0.1.0+` when ratified.

Publish a `@kernloop/contracts@0.0.0` placeholder to claim the scope:

```bash
mkdir -p /tmp/kernloop-scope && cd /tmp/kernloop-scope
cat > package.json <<'EOF'
{
  "name": "@kernloop/contracts",
  "version": "0.0.0",
  "description": "Placeholder claiming the @kernloop scope. Real package ships from github.com/kernloop/kernloop.",
  "license": "MIT"
}
EOF
npm login
npm publish --access public
```

Optionally also claim the unscoped binary name:

```bash
mkdir -p /tmp/kernloop-bin && cd /tmp/kernloop-bin
cat > package.json <<'EOF'
{
  "name": "kernloop",
  "version": "0.0.0",
  "description": "Placeholder for the kernloop CLI. Real package ships from github.com/kernloop/kernloop.",
  "license": "MIT"
}
EOF
npm publish --access public
```

## 3. Domains — HUMAN

- Register **kernloop.dev** (primary target) at your registrar of choice.
- Optionally register **kernloop.io**.
- **kernloop.com is parked by a third party** — noted; do not chase it.

## 4. Rulesets — DONE (agent: applied at P0 exit, per phase protocol)

Governance-of-the-governor. The ruleset below targets `main`: all changes via
PR, code-owner (human) review required — CODEOWNERS scopes this to
`packages/contracts/**`, `packages/kernel/**`, `claims/**`, `AGENTS.md`,
`.github/**` — required status checks `claims:check`, `governance`, `test`,
no force-push, no branch deletion. Applied with:

```bash
gh api repos/kernloop/kernloop/rulesets -X POST --input - <<'EOF'
{
  "name": "main-governance",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "test" },
          { "context": "claims:check" },
          { "context": "governance" }
        ]
      }
    }
  ]
}
EOF
```

**Amendment (2026-06-10, human-instructed):** the require-review rule
deadlocks a solo-maintainer repo — GitHub forbids authors approving their own
PRs, and every PR here is authored under the maintainer's token. A
Repository-admin bypass scoped to **pull requests only** was added (ratified
in-session by the human before the P1 merge): admins may merge a PR lacking a
second reviewer; direct pushes and force-pushes remain blocked for everyone;
bypass use is recorded by GitHub. Applied with:

```bash
gh api repos/kernloop/kernloop/rulesets/17478829 -X PUT --input - <<'EOF'
{ "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" } ] }
EOF
```

Secret scanning + push protection + Dependabot alerts:

```bash
gh api repos/kernloop/kernloop -X PATCH --input - <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF
gh api repos/kernloop/kernloop/vulnerability-alerts -X PUT
```

Dependabot version updates are configured in-repo at `.github/dependabot.yml`.

## 5. CODEOWNERS — DONE (agent: in-repo)

`.github/CODEOWNERS` covers `packages/contracts/`, `packages/kernel/`,
`claims/`, `AGENTS.md`, and `.github/` → `@williamzujkowski`. Verified by
`governance:check` in CI.
