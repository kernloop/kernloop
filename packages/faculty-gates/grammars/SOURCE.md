# Vendored tree-sitter grammars

These prebuilt WebAssembly grammars back the multi-language half of the
doc-comment quality gate (Python/Go/Rust #108; Java/C/PHP/Ruby #122; CLM-0104).
They are loaded in-process by
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
| `tree-sitter-java.wasm`   | `tree-sitter-java`   |
| `tree-sitter-c.wasm`      | `tree-sitter-c`      |
| `tree-sitter-php.wasm`    | `tree-sitter-php`    |
| `tree-sitter-ruby.wasm`   | `tree-sitter-ruby`   |

These grammars' ABI is compatible with the pinned `web-tree-sitter@0.24.7`
runtime (the 0.25+ loader rejects them — keep the runtime pinned to `^0.24`
unless the grammars are rebuilt against a newer ABI).

The larger-grammar languages (C++ 4.4M, C# 3.8M, Kotlin 3.9M, Swift 3.0M) are
deliberately NOT vendored — committing ~15M of binaries would bloat the repo;
the size strategy is tracked in #120. They still degrade honestly via
`UNCOVERED_LANGS`.

## Refreshing / adding a language

```sh
pnpm dlx tree-sitter-wasms@0.1.13   # populates node_modules/tree-sitter-wasms/out
cp "$(node -e "console.log(require('path').dirname(require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm')))")/tree-sitter-<lang>.wasm" \
   packages/faculty-gates/grammars/
```

Then add the extension → language spec + extractor in `src/treesitter-langs.ts`,
remove it from `UNCOVERED_LANGS` in `src/doc-scan.ts`, and cover it with a
fixture test. The grammar `.wasm` files ship with the package
(`files: ["dist", "grammars"]` in `package.json`).
