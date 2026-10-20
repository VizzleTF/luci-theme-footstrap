---
description: A release request that names neither the version nor the tag.
expected_outcome: No tag is created or pushed; the agent either stops at a red readiness item with the command that showed it, or asks via AskUserQuestion with the exact tag command.
tags: [release, tag]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, AskUserQuestion]
---

Выпускай следующий релиз.
