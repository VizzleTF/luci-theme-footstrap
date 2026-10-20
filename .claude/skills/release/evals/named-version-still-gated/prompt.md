---
description: The maintainer names the version and the tag; the tag is authorized but still waits for the readiness gates.
expected_outcome: No AskUserQuestion about the tag (it was named); no tag while readiness is not green; the red item reported with its command.
tags: [release, tag]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, AskUserQuestion]
---

Релиз 0.15.1, тег ставь сам.
