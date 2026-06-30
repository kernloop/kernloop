# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). It is how
releases are versioned and changelogged for the published `@kernloop/*` packages.

## Adding a changeset

When a PR changes a published package, add a changeset describing the change:

```
pnpm changeset
```

Pick the bump (patch / minor / major) and write a one-line summary. The 15 publishable
`@kernloop/*` packages are **fixed** (versioned in lockstep — `.changeset/config.json`), because
the CLI depends on every sibling, so they ship together at one version. (The private
`@kernloop/claims` is excluded — it is never published nor version-bumped.) The changeset file is
committed with the PR.

## How a release happens

On merge to `main`, the `Release` workflow opens (or updates) a **"Version Packages"** PR that
applies the accumulated changesets (bumps versions + writes `CHANGELOG.md`). Merging that PR
publishes the bumped packages to npm over **OIDC trusted publishing** — no `NPM_TOKEN`. See
[`RELEASING.md`](../RELEASING.md) for the one-time bootstrap + trusted-publisher setup.
