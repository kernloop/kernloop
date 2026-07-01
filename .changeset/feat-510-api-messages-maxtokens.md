---
'@kernloop/kernel': patch
'@kernloop/cli': patch
---

feat(api): system/multi-message body + per-endpoint configurable max_tokens (#510)

The `api` adapter now accepts a caller-supplied chat `messages` array (system /
user / assistant), sent verbatim, with the existing single-user-message
assembled from `prompt` as the unchanged fallback. Messages are validated
fail-closed before the key read and any egress. `max_tokens` is configurable
per endpoint via the overlay `maxTokens` (default 4096), clamped to a hard cap
(128k) at parse so config can never inflate the completion ceiling. Prerequisite
for the endpoint-diverse vote panel (#509). [CLM-0187]
