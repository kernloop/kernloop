---
name: Review finding
about: A problem surfaced by a QA, security, or vestigial-cleanup round
title: '<area>: <one-line problem>'
labels: review-finding
---

**Severity:** critical | high | medium | low (note if proven vs suspected)

**Where:** `path/to/file.ts:line`

**The problem:** what is wrong and why it matters. For security, trace the
concrete exploit path. For honesty, state what the evidence actually proves
vs what the claim says.

**Fix:** the concrete change.

**Source:** which review round / reviewer surfaced this.
