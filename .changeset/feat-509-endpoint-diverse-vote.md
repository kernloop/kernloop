---
'@kernloop/cli': patch
---

feat(vote): endpoint-diverse per-model vote panel, honest about the single-oracle gap (#509)

For an endpoint-only ratification run whose endpoint serves ≥2 chat-capable
models (from `models sync`'s `/v1/models`), kernloop now convenes a panel-7
across those distinct models instead of one model role-playing N personas. The
`/v1/models` set is filtered to chat models (embeddings/moderation/audio/image/
rerank dropped and audited). It is framed honestly as model-NAME diversity
within ONE oracle: two visible Verdict findings state it is NOT cross-provider
independence, does not close the single-oracle gap [CLM-0164], and that neither
high nor low inter-voter disagreement establishes independence; the measured
divergence counts only voters that actually balloted. A distinct audit records
the posture, and the #348 parity gate excludes this signal from the independence
window. Cross-provider voting remains the real oracle-diversity path. [CLM-0188]
