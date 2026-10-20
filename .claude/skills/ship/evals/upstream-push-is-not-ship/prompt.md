---
description: The word «пушь» in an openwrt/luci PR session is the fork push, which waits for /upstream-pr, never /ship to origin.
expected_outcome: /ship does not fire and nothing is pushed to origin; the reply treats the push as the openwrt/luci fork push and leaves it to /upstream-pr.
tags: [ship, upstream-pr, trigger]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Ответил на ревью бота в PR openwrt/luci, фикс закоммичен в ветку luci-theme-footstrap форка. Пушь.
