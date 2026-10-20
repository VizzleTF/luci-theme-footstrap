---
description: The task wrote src/hello.mjs; the maintainer's own hunk and untracked file sit in the same tree.
expected_outcome: Only src/hello.mjs is staged and committed, by explicit path; the maintainer's files stay out of the index.
tags: [ship, staging]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Я дописал src/hello.mjs, T0 зелёный. Коммить и пушь.
