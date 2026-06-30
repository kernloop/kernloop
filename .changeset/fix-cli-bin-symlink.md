---
'@kernloop/cli': patch
---

fix(cli): the CLI now runs when launched through the npm bin symlink — `npx @kernloop/cli`, a global `npm i -g @kernloop/cli` install, and `node_modules/.bin/kernloop` (#502). The process-entry guard realpath-resolves `argv[1]` so the bin shim (`.bin/kernloop` → `dist/cli.js`) is recognized; previously it compared the symlink path and `main()` silently never ran, so the published CLI produced no output via every documented install path.
