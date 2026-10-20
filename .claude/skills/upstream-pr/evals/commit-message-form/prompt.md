---
description: Commit message for one upstream fix, given with an issue link that must stay out of the commit body.
expected_outcome: 'Subject `luci-theme-footstrap: <lowercase>` of at most 60 chars without a final period; body one or two sentences wrapped at 72; no link or #NNNN in the commit body; Signed-off-by line.'
tags: [upstream-pr, message]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

Напиши сообщение коммита для PR в апстрим. Что сделано: в мобильном меню при повороте экрана
выпадающий список уезжал за край, теперь он ограничен шириной вьюпорта. Это закрывает
https://github.com/openwrt/luci/issues/9123, мы три дня искали причину, виновато было
min-width: max-content на .dropdown.
