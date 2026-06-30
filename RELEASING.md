# Releasing kernloop to npm

The `@kernloop/*` packages publish to npm via **changesets** + **OIDC trusted publishing**
(no `NPM_TOKEN` in CI). The CLI depends on every sibling package, so all 15 publishable
`@kernloop/*` packages ship **in lockstep at one version** (changesets `fixed`).

> **Why a manual bootstrap?** npm trusted publishing can only attach to a package that
> **already exists** on the registry — so OIDC cannot perform the _first_ publish of a
> brand-new package. The one-time bootstrap below is the only step that uses an npm
> credential; every release after it is tokenless OIDC via `.github/workflows/release.yml`.

## One-time bootstrap (operator — needs npm auth)

**Prerequisites (confirm on npm first):**

- The `kernloop` org/scope exists and your npm account is a member with **publish** rights.
- (Recommended) the org permits public scoped packages; 2FA enabled.
- **GitHub repo setting:** Settings → Actions → General → "Allow GitHub Actions to create and
  approve pull requests" is **enabled** — otherwise the ongoing "Version Packages" PR step
  fails silently (the workflow needs it to open that PR).

**Steps:**

1. Build and inspect exactly what will ship (no publish):

   ```sh
   pnpm install --frozen-lockfile && pnpm build
   pnpm -r exec npm pack --dry-run    # review each tarball's file list — dist/ only, no src/tests/secrets
   ```

2. Authenticate for the **one-time** bootstrap only (OIDC can't create new packages).
   **If the account has 2FA enabled** (it does), `npm login` then makes every `publish` prompt
   for a fresh OTP — and a single code **times out partway through** the 15 sequential publishes
   (`EOTP`). So use a short-lived **granular access token** instead, which bypasses the
   interactive OTP:

   - npmjs.com → **Access Tokens → Generate New Token → Granular Access Token**
   - Permissions: **Packages and scopes → Read and write**, scoped to the **@kernloop** scope
   - Expiration: short (e.g. 1 day — revoke right after, step 5)
   - Then, in your terminal:

   ```sh
   echo "//registry.npmjs.org/:_authToken=<TOKEN>" >> ~/.npmrc
   ```

   (Alternatively `npm login` + pass `--otp=<code>` on the publish, re-running with a fresh code
   each time it times out — slower, but works.)

3. Bootstrap-publish all 15 at the current `0.1.0`, in dependency order (pnpm rewrites
   `workspace:*` → the concrete version):

   ```sh
   pnpm -r publish --access public --no-git-checks
   ```

   **If it fails partway:** re-running is safe — pnpm/npm skip packages whose version is
   already published (a `409`/`EPUBLISHCONFLICT` on an already-shipped package is benign),
   so just re-run the same command until all 15 are up. Do **not** bump the version to
   recover a partial run.

4. Register the **trusted publisher** for **each** of the 15 packages so future releases use
   OIDC. On npmjs.com: package → **Settings → Trusted Publisher** → GitHub Actions, with:
   - Repository: `kernloop/kernloop` (case-exact)
   - Workflow filename: `release.yml`

   (A `npm trust`/`npm access` CLI equivalent may exist in your npm version — verify against
   `npm help` before scripting it; the web UI is the reliable path.)

5. (Optional hardening) revoke the bootstrap token and set the account to
   "trusted-publishing only", so the only path to publish is the registered workflow.

6. **Verify the OIDC path end-to-end before declaring the pipeline operational.** The bootstrap
   used a token; the tokenless OIDC path has not yet run. Drive one real release through it —
   add a trivial changeset, merge to `main`, merge the resulting "Version Packages" PR, and
   confirm the bumped versions appear on npm **with provenance** (the npm package page shows a
   "Built and signed on GitHub Actions" badge). Only after that first tokenless release succeeds
   is the pipeline proven.

## Ongoing releases (no token, agent-drivable)

1. A PR that changes a published package adds a changeset: `pnpm changeset` (pick the bump,
   write a summary). The changeset file is committed with the PR.
2. On merge to `main`, the **Release** workflow opens/updates a **"Version Packages"** PR
   (bumps versions + writes `CHANGELOG`).
3. Merging that PR runs `pnpm changeset publish` over OIDC → the bumped packages publish with
   automatic provenance. No credential is handled in CI.

> **Do not rename `release.yml`** — each package's trusted publisher is registered against
> that exact filename; a rename silently breaks publishing until re-registered.
