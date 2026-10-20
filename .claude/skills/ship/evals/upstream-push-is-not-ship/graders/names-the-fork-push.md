---
type: llm
---

PASS if the final message treats the push as the openwrt/luci fork push for the PR (the
/upstream-pr procedure) and does not report a push to origin/main or a CI watch of this repo.
FAIL if it ran or reports /ship, a push to origin, or a CI watch of origin/main.
