---
type: llm
---

Judge only the proposed commit message, not any PR body shown next to it.
PASS if: the subject is at most 60 characters with no final period; the body is one or two
sentences saying what changed, no line longer than 72 columns; the body carries no URL and no
`#9123`; the three-day investigation is not in the body.
FAIL if any of these is broken.
