# @kernloop/cli

## 0.1.3

### Patch Changes

- Updated dependencies [d04062f]
  - @kernloop/kernel@0.1.3
  - @kernloop/faculty-gates@0.1.3
  - @kernloop/faculty-toolsmith@0.1.3
  - @kernloop/contracts@0.1.3
  - @kernloop/docscan@0.1.3
  - @kernloop/faculty-compiler@0.1.3
  - @kernloop/faculty-memory@0.1.3
  - @kernloop/faculty-models@0.1.3
  - @kernloop/faculty-observer@0.1.3
  - @kernloop/faculty-scrum@0.1.3
  - @kernloop/faculty-workforce@0.1.3
  - @kernloop/parsimony@0.1.3
  - @kernloop/tracker@0.1.3
  - @kernloop/workflows@0.1.3

## 0.1.2

### Patch Changes

- ba2e306: fix(cli): the CLI now runs when launched through the npm bin symlink — `npx @kernloop/cli`, a global `npm i -g @kernloop/cli` install, and `node_modules/.bin/kernloop` (#502). The process-entry guard realpath-resolves `argv[1]` so the bin shim (`.bin/kernloop` → `dist/cli.js`) is recognized; previously it compared the symlink path and `main()` silently never ran, so the published CLI produced no output via every documented install path.
  - @kernloop/contracts@0.1.2
  - @kernloop/docscan@0.1.2
  - @kernloop/faculty-compiler@0.1.2
  - @kernloop/faculty-gates@0.1.2
  - @kernloop/faculty-memory@0.1.2
  - @kernloop/faculty-models@0.1.2
  - @kernloop/faculty-observer@0.1.2
  - @kernloop/faculty-scrum@0.1.2
  - @kernloop/faculty-toolsmith@0.1.2
  - @kernloop/faculty-workforce@0.1.2
  - @kernloop/kernel@0.1.2
  - @kernloop/parsimony@0.1.2
  - @kernloop/tracker@0.1.2
  - @kernloop/workflows@0.1.2

## 0.1.1

### Patch Changes

- f1187a3: Exercise the npm OIDC release pipeline end-to-end (#495): first tokenless release with provenance. All 15 `@kernloop/*` packages bump in lockstep via the `fixed` group.
  - @kernloop/contracts@0.1.1
  - @kernloop/docscan@0.1.1
  - @kernloop/faculty-compiler@0.1.1
  - @kernloop/faculty-gates@0.1.1
  - @kernloop/faculty-memory@0.1.1
  - @kernloop/faculty-models@0.1.1
  - @kernloop/faculty-observer@0.1.1
  - @kernloop/faculty-scrum@0.1.1
  - @kernloop/faculty-toolsmith@0.1.1
  - @kernloop/faculty-workforce@0.1.1
  - @kernloop/kernel@0.1.1
  - @kernloop/parsimony@0.1.1
  - @kernloop/tracker@0.1.1
  - @kernloop/workflows@0.1.1
