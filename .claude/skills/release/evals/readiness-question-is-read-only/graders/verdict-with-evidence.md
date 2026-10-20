---
type: llm
---

PASS if the final message gives a ready / not-ready verdict and, for every item it calls red or
unknown (for example CI status that gh could not read), names the command that showed it.
FAIL if it says main is ready without having read CI, or says it committed, pushed or tagged.
