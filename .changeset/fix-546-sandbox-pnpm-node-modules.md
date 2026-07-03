---
'@kernloop/faculty-gates': patch
---

fix(gates): copy every workspace package's node_modules into the sandbox scratch, not just the workspace root — resolves pnpm symlink-farm breakage inside network-none docker (#546). [CLM-0191]
