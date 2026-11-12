# Contributing

How to send a patch to luci-theme-footstrap, for anyone who wants to change the theme.
The most important rule: a change is not finished until it has run on a real OpenWrt router, on both package managers.

This page is the short version. Every rule is written out, with the reason behind it, in [`docs/`](docs/README.md).

## Read two pages before you start

1. Read [`docs/architecture.md`](docs/architecture.md). It says what LuCI expects of a theme and where this one plugs in.
2. Read the page for the area you are touching:

| Touching | Read |
|---|---|
| `styles/` | [css.md](docs/css.md), [design-system.md](docs/design-system.md) |
| `fs-*.js`, `*.ut` | [chrome.md](docs/chrome.md), [spa-router.md](docs/spa-router.md) |
| `Makefile`, `root/`, `po/` | [package.md](docs/package.md) |
| a foreign `luci-app-*` looking wrong | [third-party-apps.md](docs/third-party-apps.md) |

The rule list itself is [`docs/conventions.md`](docs/conventions.md), with the reason for each rule.

## Test every change on a real router

Two checks run on a real OpenWrt router:

| Check | What it does |
|---|---|
| `tools/e2e.mjs` | Installs the last release and upgrades it to your build. Opens every menu page under footstrap and under bootstrap. Then removes and reinstalls the package. |
| `tools/anchor-check.mjs` | Checks that a poll tick above a parked reader leaves them in place. |

[`docs/verifying.md`](docs/verifying.md) says what they prove. [`docs/run-checks.md`](docs/run-checks.md) says how to run them.
[`docs/development.md`](docs/development.md) sets up the `owlab` routers they run on.
Fixing a CSS bug: follow [the path](docs/development.md#fixing-a-css-bug-the-path). The two checks do not judge how a page looks; a computed-style diff proves a CSS change.

Rule: a change is not finished until it has run on a real OpenWrt userland with both package managers, 25.12/apk and 24.10/opkg.

CI's `e2e` and `anchor` jobs run the checks on both for every pull request that touches more than documentation.

Rule: if you cannot run the checks yourself, say so in the pull request.
Why: an untested change described as tested is worse than an untested one.

Say in the pull request which routers the checks ran on. Example line:
`Tested: e2e and anchor green on owrt2512 (25.12/apk) and owrt2410 (24.10/opkg).`

## Keep node out of the package source

Rule: the tooling may need node; the package source never may.
Why: no npm package is installed on a router. The OpenWrt buildbot has no node, and `luci.mk` copies `htdocs/` and `ucode/` verbatim.

The release build (`tools/stage.sh`) runs uglify-js and acorn over the shipped JS and templates.

## What a pull request needs

| Need | Detail |
|---|---|
| One concern per branch | A layout fix and a packaging fix are two branches. |
| Conventional Commits | In English, present tense: `fix(chrome): …`, `feat(appearance): …`. |
| A changelog entry in both files | See [Changelog entries](#write-a-changelog-entry-in-both-files-for-user-visible-changes) below. |
| A green `e2e` and `anchor` on both routers | A red run is fixed in the code under it, not in the check. |
| A comment that says why | See [Comments](#write-comments-that-say-why) below. |

### Write a changelog entry in both files for user-visible changes

1. Add the entry to `CHANGELOG.md` and `CHANGELOG_ru.md`, under `## [Unreleased]`, in the same order.
   This applies to a change a theme user sees. CI, tests, tooling and docs changes get no entry.
2. Run `npm run changelog` to check it. CI does not run it.

The contract is in [`docs/releasing.md`](docs/releasing.md).

### Write comments that say why

The codebase's comments carry the constraint, the alternative that failed and the number that was measured.
They do not restate the line below them.
A negative result is worth one line: it saves the next person the experiment.

## Match the surrounding style

- `.editorconfig` covers indentation and line endings. Match the surrounding code for the rest.
- Do not reformat code you are not otherwise changing.
- Translations go through the `po/` catalogues. Run `luci-theme-footstrap/update-po.sh` after touching any `_()` string.

## Report bugs in issues, vulnerabilities privately

A bug or an idea: open an issue.
A vulnerability: report it privately, as [SECURITY.md](SECURITY.md) says, not in an issue.
