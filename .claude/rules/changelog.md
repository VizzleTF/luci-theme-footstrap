---
paths:
  - "CHANGELOG*.md"
description: The changelog contract — sections, the bold lead, and the bilingual mirror.
---

# The changelog

**NO COMMIT LANDS WITHOUT ITS CHANGELOG ENTRY.** It goes under `## [Unreleased]`, in the **same
commit as the code**, and in **BOTH `CHANGELOG.md` AND `CHANGELOG_ru.md`** — never one now and its
mirror later. An entry written afterwards is written from the diff, and the diff is exactly what
does not know why. This covers documentation, benchmarks, CI and packaging too, not just code: if
the commit is worth making, it is worth one line saying what changed. The only things that skip it
are `CLAUDE.md` and a fix to an `[Unreleased]` entry already written.

Enforced by `.claude/hooks/precommit-gate.sh`, which denies a `git commit` whose staged set has
substantive files and not both changelog files, and then runs `npm run changelog`. The hook is the
defence; this page is the reason, and the prose below is the half no gate can check.

- Sections are `Added / Changed / Deprecated / Removed / Fixed / Security / Performance`, one of
  each per version, in that fixed order — append into the section that already exists in its
  canonical slot, never add a second `### Changed` on top.
- Each entry is `- **one-line effect.** then the rationale`. The bold lead **is** the release note
  (`release-notes.sh` emits leads only), so it must read on its own — **a bullet with no bold lead
  is silently dropped from the release**. Write the effect, not the diff; keep the measurement.
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
