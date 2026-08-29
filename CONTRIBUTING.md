# Contributing

Patches are welcome. This page is the short version; every rule below is written out, with the
measurement behind it, in [`docs/`](docs/README.md).

## Before you start

Read [`docs/architecture.md`](docs/architecture.md) — what LuCI expects of a theme and where this
one plugs in. Then the page for the area you are touching:

| Touching | Read |
|---|---|
| `styles/` | [css.md](docs/css.md), [design-system.md](docs/design-system.md) |
| `fs-*.js`, `*.ut` | [chrome.md](docs/chrome.md), [spa-router.md](docs/spa-router.md) |
| `Makefile`, `root/`, `po/` | [package.md](docs/package.md) |
| a foreign `luci-app-*` looking wrong | [third-party-apps.md](docs/third-party-apps.md) |

The rule list itself is [`docs/conventions.md`](docs/conventions.md), and each rule names the gate
that holds it.

## The loop

```sh
npm ci
npm run check:fast   # the 16 gates that need no browser and no CSS build
npm run check        # all of them; must exit 0 before you open a pull request
```

A change that alters behaviour is not finished until it has run on a real OpenWrt userland — both
package managers, 25.12/apk and 24.10/opkg. [`docs/development.md`](docs/development.md) sets that
up with `owlab` in a few minutes. If you cannot run it, say so in the pull request rather than
describing the change as verified; an untested change described as tested is worse than an untested
one.

Nothing in `package.json` ships. `luci.mk` copies `htdocs/` and `ucode/` verbatim, and the OpenWrt
buildbot has no node — so a gate may need node, and the package never may.

## What a pull request needs

- **One concern per branch.** A layout fix and a packaging fix are two branches.
- **Conventional Commits**, in English, present tense: `fix(chrome): …`, `feat(appearance): …`.
- **A changelog entry in both files** — `CHANGELOG.md` and `CHANGELOG_ru.md`, same version, same
  order. `npm run changelog` checks it.
- **Green gates.** CI re-runs everything plus the jobs that need a router; a red `check` locally
  will be red there.
- **A comment that says why.** The codebase's comments carry the constraint, the alternative that
  failed and the number that was measured — not a restatement of the line below them. A negative
  result is worth one line and saves the next person the experiment.

## Style

`.editorconfig` covers indentation and line endings; `eslint` and `stylelint` cover the rest and
both run in `npm run check:fast`. Do not reformat code you are not otherwise changing.

Translations go through the `po/` catalogues — run `luci-theme-footstrap/update-po.sh` after
touching any `_()` string.

## Reporting things

A bug or an idea: open an issue. A vulnerability: [SECURITY.md](SECURITY.md) — privately, not in an
issue.
