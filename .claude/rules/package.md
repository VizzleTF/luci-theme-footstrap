---
paths:
  - "**/Makefile"
  - "**/root/**"
  - "**/po/**"
  - "**/owfeed.yml"
  - "install.sh"
description: Packaging invariants that fail silently on somebody else's router.
---

# Package

Every rule here shares one shape: nothing fails at build time, and the damage lands on a router that
is not yours, weeks later. Four of them are now held by `npm run makefile-contract`
(`tools/makefile-contract.mjs`) and the rest by the gates named beside them.

- **`+luci-base` is the whole dependency list and keeping it that way is a constraint.** `curl` is
  not in OpenWrt's default set — fall back to `uclient-fetch` instead of adding a dep.
- **The catalogue lives in `po/`** — what `LUCI_LANGUAGES` globs and what Weblate translates.
  luci.mk emits the per-language packages and so does owfeed: `luci-i18n-footstrap-<lang>`, catalogue
  `footstrap.<lang>.lmo`, plus a uci-defaults line registering the language. The theme itself carries
  NO catalogue — two packages owning one path is an install apk refuses. `po/`, `tools/stage.sh`
  (staging trees + the language label) and `owfeed.yml` all repeat the language list and are held
  together by `npm run i18n-packages`; `tools/check-packages.sh` asserts the built set.
- Anything under `root/etc/config/` MUST be in the `conffiles` define (`npm run conffiles`) — else
  the manager replaces it on upgrade and the theme's own Update wipes the admin's saved defaults,
  reporting success.
- `postinst`/`postrm` use **`rpcd reload`, never `restart`** — restart logs out every LuCI session.
- A malformed `acl.d/*.json` is skipped by rpcd **silently**, so the grant goes to nobody and only
  Save-as-default and the background upload break, on someone else's router (`npm run acl`).
- `root/etc/uci-defaults/30_luci-theme-footstrap` is the single source of registration; fresh
  install vs upgrade is the marker file `/usr/share/luci-theme-footstrap/.installed`, and **an
  upgrade must never change the active theme** (`$PKG_UPGRADE` is dead — apk never exports it).
- Do not set `PKG_VERSION` (git-derived). `LUCI_MINIFY_CSS:=0` — csstidy mangles `:has()` and
  `color-mix()`.
- The Makefile's buildroot signature line is what `include/scan.mk` greps for to see the package at
  all. It must stay last, with nothing between it and the text it announces (`npm run marker`); it
  has been deleted as boilerplate once.
- **The trust chain fails closed**: a verified TLS channel (never `-k`, never as a retry), an
  ed25519 `usign` signature, then GitHub's sha256. The signature is the link that holds — GitHub
  *computes* the asset digest, so a swapped asset passes the checksum. A missing digest, `.sig` or
  usign is a refusal, not a downgrade.

After an edit here, T0 is the one gate that covers the file: `npm run makefile-contract` and
`npm run marker` for the Makefile (they read different lines — run both), `npm run conffiles` for
`root/etc/config/**`, `npm run acl` for `acl.d/**`, `npm run i18n` for `po/**`, `npm run shell` for
any `*.sh`.

Deeper: `docs/package.md`, `docs/ci.md`.
