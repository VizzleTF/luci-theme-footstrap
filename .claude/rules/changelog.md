---
paths:
  - "CHANGELOG*.md"
description: The changelog contract — sections, the bold lead, and the bilingual mirror.
---

# The changelog

**No commit lands without its changelog entry.** It goes under `## [Unreleased]`, in the **same
commit as the code**, and in **both `CHANGELOG.md` and `CHANGELOG_ru.md`** — never one now and its
mirror later. An entry written afterwards is written from the diff, and the diff is exactly what
does not know why. This covers documentation, benchmarks, CI and packaging too, not just code: if
the commit is worth making, it is worth one line saying what changed. The only things that skip it
are `CLAUDE.md` and a fix to an `[Unreleased]` entry already written.

Enforced by `.claude/hooks/precommit-gate.sh`, which denies a `git commit` whose staged set has
substantive files and not both changelog files, and then runs `npm run changelog`. The hook is the
defence; this page is the reason, and the prose below is the half no gate can check.

- List entries with `grep -n '^- \*\*' CHANGELOG.md`; never cat the `[Unreleased]` block.
- `npm run changelog` also fails when the newest released `## [X]` differs from `git show vX:CHANGELOG.md`
  (a rebase or cherry-pick moved an entry into it). `node tools/changelog.mjs add <0-7> --en '- **…**' --ru '- **…**'`
  puts one bullet pair into both files' `[Unreleased]` (0 = Added … 7 = Development), in the worktree and the index only, and creates the heading when a release left none. One call does both steps: `node tools/changelog.mjs add <n> --en … --ru … && git commit -m …`; the hook reads the staged set as if `add` had run.
  Not checked: that a bullet sits under the same `###` as in its commit — that needs `git log -S` per bullet, which a reword or rebase breaks.
- Sections are `Added / Changed / Deprecated / Removed / Fixed / Security / Performance / Development`
  (`Добавлено … Производительность / Разработка`), one of each per version, in that fixed order —
  append into the section that already exists in its canonical slot, never add a second `### Changed`
  on top.
- **`Development` (index 7) is for what a router running the package never shows or does:** the crew,
  hooks, gates, CI, tooling, tests, agent docs. An entry is user-facing, and goes under its own
  section, when it changes `luci-theme-footstrap/**`, `install.sh`, the feed or the published package;
  everything else is `Development`, and `release-notes.sh` leaves that section out of the release page.
  A fix to the trust chain a user installs through (`install.sh`, the signing keys, `tools/stage-release.sh`,
  the `release` job, the feed) is `Security` even when only CI files change.
  A change with both halves gets two entries, one per section. The every-commit rule above holds for
  `Development` too: it is where a tooling commit's entry goes, not a way to skip it.
- Each entry is `- **one-line effect.** then the rationale`. The bold lead **is** the release note
  (`release-notes.sh` emits leads only, `Development` excepted), so it must read on its own — **a bullet
  with no bold lead is silently dropped from the release**. Write the effect, not the diff; keep the measurement.
- **Keep the number the change was made for.** "20 KB of font for 227 labels", "312 of 336 elements
  recoloured by a hostile `:root`", "1.69:1 where AA wants 4.5" — the measurement is the difference
  between a changelog and a marketing blurb.
- **Do not cite commits** or retell a file's history. **Edit the existing entry; do not append a
  second one.** Merge related commits into one entry.
- The two files are **edited in one commit**. Same section set and order, same numbers, versions and
  `compare` links — only the prose may differ, never the facts. The English file is the primary
  source for the release-note generator.

`npm run changelog` holds the mechanical half: the set, order and uniqueness of sections, empty
sections, dates, `compare` links, mirror parity and the mandatory bold lead. It exists because
`[Unreleased]` once accumulated a **duplicate `### Changed`** over several commits, each of which
looked fine on its own, and the notes are generated at tag time when the tag is already pushed.

The full contract, its sources and the anti-patterns: `docs/releasing.md`. Cutting a release is the
`/release` skill.
