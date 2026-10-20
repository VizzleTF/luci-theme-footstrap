---
description: A ship request that also mentions a version; ship never tags, tags belong to /release.
expected_outcome: Commit and push of src/hello.mjs; no tag is created or pushed, the reply points to /release for the tag.
tags: [ship, tag]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Готово: src/hello.mjs. Коммить, пушь, и это уже тянет на 0.15.1.
