# Contributing

Patches are welcome. This page is the short version; every rule below is written out, with the
reason behind it, in [`docs/`](docs/README.md).

## Before you start

Read [`docs/architecture.md`](docs/architecture.md) — what LuCI expects of a theme and where this
one plugs in. Then the page for the area you are touching:

| Touching | Read |
|---|---|
| `styles/` | [css.md](docs/css.md), [design-system.md](docs/design-system.md) |
| `fs-*.js`, `*.ut` | [chrome.md](docs/chrome.md), [spa-router.md](docs/spa-router.md) |
| `Makefile`, `root/`, `po/` | [package.md](docs/package.md) |
| a foreign `luci-app-*` looking wrong | [third-party-apps.md](docs/third-party-apps.md) |

The rule list itself is [`docs/conventions.md`](docs/conventions.md), with the reason for each rule.

## The loop

Two checks run on a real OpenWrt router. `tools/e2e.mjs` installs the last release, upgrades it to
your build, opens every menu page under footstrap and under bootstrap, then removes and reinstalls
the package. `tools/anchor-check.mjs` checks that a poll tick above a parked reader leaves them in
place. [`docs/verifying.md`](docs/verifying.md) says what they prove and how to run them;
[`docs/development.md`](docs/development.md) sets up the `owlab` routers they run on.

A change is not finished until it has run on a real OpenWrt userland — both package managers,
25.12/apk and 24.10/opkg. CI's `e2e` and `anchor` jobs run the checks on both for every pull
request that touches more than documentation. If you cannot run it yourself, say so in the pull
request instead of describing the change as verified. An untested change described as tested is
worse than an untested one.

No npm package is installed on a router. The release build (`tools/stage.sh`) runs uglify-js and
acorn over the shipped JS and templates. But `luci.mk` copies `htdocs/` and `ucode/` verbatim, and
the OpenWrt buildbot has no node. So the tooling may need node, and the package source never may.

## What a pull request needs

- **One concern per branch.** A layout fix and a packaging fix are two branches.
- **Conventional Commits**, in English, present tense: `fix(chrome): …`, `feat(appearance): …`.
- **A changelog entry in both files** (`CHANGELOG.md` and `CHANGELOG_ru.md`, under `## [Unreleased]`,
  same order) for a change a theme user sees. CI, tests, tooling and docs changes get no entry. Run
  `npm run changelog` to check it; CI does not run it. The contract:
  [`docs/releasing.md`](docs/releasing.md).
- **A green `e2e` and `anchor`** on both routers. A red run is fixed in the code under it, not in
  the check.
- **A comment that says why.** The codebase's comments carry the constraint, the alternative that
  failed and the number that was measured — not a restatement of the line below them. A negative
  result is worth one line and saves the next person the experiment.

## Style

`.editorconfig` covers indentation and line endings; match the surrounding code for the rest. Do
not reformat code you are not otherwise changing.

Translations go through the `po/` catalogues — run `luci-theme-footstrap/update-po.sh` after
touching any `_()` string.

## Reporting things

A bug or an idea: open an issue. A vulnerability: [SECURITY.md](SECURITY.md) — privately, not in an
issue.
