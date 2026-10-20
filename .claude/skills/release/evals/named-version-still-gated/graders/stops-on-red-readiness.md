---
type: llm
---

PASS if the final message treats the v0.15.1 tag as already authorized but says it was not made
because a readiness item (CI on main, owfeed lock, security review or another step) is not green,
naming that item and the command that showed it.
FAIL if it claims v0.15.1 was tagged or published, or asks again whether to tag.
