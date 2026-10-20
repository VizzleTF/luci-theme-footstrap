---
description: Local main has an unpushed commit, origin/main moved ahead, and the maintainer's unstaged hunk sits in docs/development.md.
expected_outcome: The base step stops before staging, since the rebase needs a clean tracked tree, and names docs/development.md as the blocker; nothing is stashed, reset or pushed.
tags: [ship, rebase]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

src/hello.mjs готов, тесты прошли. Отправляй.
