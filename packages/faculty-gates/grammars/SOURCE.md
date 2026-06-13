# Vendored tree-sitter grammars

These prebuilt WebAssembly grammars back the multi-language half of the
doc-comment quality gate (#108, CLM-0104). They are loaded in-process by
`src/treesitter-scan.ts` through `web-tree-sitter` — no `node-gyp`, no native
build step, so a fresh clone and CI need only the committed `.wasm` files.

## Provenance

Sourced verbatim from [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms)
`0.1.13`, which publishes prebuilt parsers for the upstream grammars:

| file                      | upstream grammar     |
| ------------------------- | -------------------- |
| `tree-sitter-python.wasm` | `tree-sitter-python` |
| `tree-sitter-go.wasm`     | `tree-sitter-go`     |
| `tree-sitter-rust.wasm`   | `tree-sitter-rust`   |

These grammars' ABI is compatible with the pinned `web-tree-sitter@0.24.7`
runtime (the 0.25+ loader rejects them — keep the runtime pinned to `^0.24`
unless the grammars are rebuilt against a newer ABI).

## Refreshing / adding a language

```sh
pnpm dlx tree-sitter-wasms@0.1.13   # populates node_modules/tree-sitter-wasms/out
cp "$(node -e "console.log(require('path').dirname(require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm')))")/tree-sitter-<lang>.wasm" \
   packages/faculty-gates/grammars/
```

Then add the extension → language entry and an extractor in
`src/treesitter-scan.ts`, remove it from `UNCOVERED_LANGS` in `src/doc-scan.ts`,
and cover it with a fixture test. The grammar `.wasm` files ship with the
package (`files: ["dist", "grammars"]` in `package.json`).
