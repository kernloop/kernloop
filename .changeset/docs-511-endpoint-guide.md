---
'@kernloop/cli': patch
---

docs(endpoints): guide for the three custom-endpoint paths + template maxTokens (#511)

Adds `docs/ENDPOINTS.md` documenting the three verified ways to route kernloop
work to a custom OpenAI-compatible endpoint (api adapter / opencode+adapterModels
/ MCP sampling) with copy-paste overlays and honest per-path limitations. Updates
the `kernloop init` overlay template: documents the new per-endpoint `maxTokens`
and corrects the `baseUrl` comment to reflect the resolve-time SSRF guard
(CLM-0186), which now blocks egress to private/loopback/metadata addresses.
