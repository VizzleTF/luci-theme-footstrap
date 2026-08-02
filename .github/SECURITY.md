# Security Policy

`luci-theme-footstrap` is a theme for LuCI, the web interface of OpenWrt. Because it runs
in the browser tab that administers a router, and the optional
`luci-app-footstrap-updater` package downloads and installs releases on the device, this
project treats security reports seriously.

## Supported versions

Only the latest published release receives security fixes. The project ships as a rolling
line of `0.9.x` releases; there are no long-term or maintenance branches. If you are
running an older version, upgrade to the current release before reporting an issue, since
it may already be fixed.

| Version            | Supported |
| ------------------ | --------- |
| Latest release     | ✅        |
| Any older release  | ❌        |

The current release is shown on the [Releases page](https://github.com/VizzleTF/luci-theme-footstrap/releases).

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/VizzleTF/luci-theme-footstrap/security).
2. Click **Report a vulnerability**.
3. Fill in the advisory form.

This keeps the report confidential until a fix is available.

If you cannot use GitHub's private reporting, email **vizzlef@gmail.com** with the
subject line `SECURITY: luci-theme-footstrap`.

### What to include

A useful report has:

- The affected version (or commit) and the OpenWrt / LuCI version it runs on.
- A description of the issue and the security impact (e.g. stored/reflected XSS,
  privilege escalation, tampering with the update channel).
- Steps to reproduce, ideally with a minimal proof of concept.
- Any relevant configuration, logs, or screenshots.

### What is in scope

- The theme assets served to the browser (JavaScript, CSS, `ucode` templates) in
  `luci-theme-footstrap/`.
- The optional updater package in `luci-app-footstrap-updater/`, especially how it
  resolves, downloads, and installs releases.

Vulnerabilities in OpenWrt, LuCI itself, `rpcd`, `uhttpd`, or third-party `luci-app`
packages are out of scope here — report those to their respective projects.

## Response

- The report will be acknowledged, typically within a few days.
- If accepted, a fix will be prepared and released, and a GitHub Security Advisory will be
  published crediting the reporter (unless anonymity is requested).
- If the report is declined, the reasoning will be explained.

## Coordinated disclosure

Please give a reasonable window to release a fix before disclosing details publicly.
Credit for the discovery is given in the advisory to anyone who wants it.
