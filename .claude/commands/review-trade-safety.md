---
description: Run trade-safety-reviewer over current diff
---

Run `git diff` + `git status` to see what's changed, then delegate to the `trade-safety-reviewer` subagent with the list of modified trading-critical files. Report findings grouped as Blocking / Should-fix / Nit.
