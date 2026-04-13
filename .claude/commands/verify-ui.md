---
description: Smoke-test the frontend via Playwright MCP after a UI change
---

Delegate to the `ui-smoke-tester` subagent. Tell it which feature was changed (from conversation context) and ask for a golden-path + edge-case run with console-error check. Relay its report back concisely.
