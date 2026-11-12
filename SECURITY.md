# Security policy

How to report a vulnerability in luci-theme-footstrap, and what the package can reach on a router.
Report privately, never in a public issue: use **[Report a vulnerability](https://github.com/VizzleTF/luci-theme-footstrap/security/advisories/new)** on GitHub.

## Report a vulnerability privately

1. Report through GitHub: Security → [Report a vulnerability](https://github.com/VizzleTF/luci-theme-footstrap/security/advisories/new).
2. If that is unavailable to you, email <vizzlef@gmail.com> with `luci-theme-footstrap` in the subject.

Please do not open a public issue for a suspected vulnerability.

Include what you have:

- the OpenWrt release and package manager (25.12/apk or 24.10/opkg);
- the theme version from *System → Footstrap*;
- the request or the page;
- what an attacker gains.

A proof of concept is welcome but not required.

## You get an answer within 7 days

| Step | When |
|---|---|
| Acknowledgement | within 7 days |
| Assessment | within 14 days |
| Confirmed fix | ships in the next release |

You will be credited in `CHANGELOG.md` unless you ask otherwise.

## Only the latest release is supported

| Version | Supported |
|---|---|
| latest release | yes |
| earlier releases | no. Upgrade first, then report if it persists. |
| 0.14.2 (the last for OpenWrt 23.05) | no. 23.05 is end-of-life upstream. |

## What this package can do

The theme is server chrome plus browser assets.
It ships no daemon, opens no port and depends on `luci-base` alone.
It adds one menu node, *System → Footstrap* (`admin/system/footstrap`), and one CGI.

The parts worth your attention:

| Part | File | What to know |
|---|---|---|
| The login page | `ucode/template/themes/footstrap/sysauth.ut` | Renders before a session exists, so it is an unauthenticated surface. The form is server-rendered on purpose. |
| The pattern CGI | `root/www/cgi-bin/luci-theme-footstrap-pattern` | See [The pattern CGI](#the-pattern-cgi-runs-before-login-and-takes-no-input). |
| The rpcd ACL | `root/usr/share/rpcd/acl.d/luci-theme-footstrap.json` | See [The rpcd ACL](#the-rpcd-acl-grants-exactly-this-list). |
| The uploads | files under `/etc/footstrap` | See [The uploads](#uploads-are-inspected-in-the-browser). |
| The browser JS | `fs-chrome.js`, `fs-search.js`, `fs-assets.js` | See [The browser JS](#the-browser-js-writes-innerhtml-in-five-places). |
| The installer | `install.sh` | Verifies a usign signature and a checksum before it installs anything. Pins 23.05 routers to 0.14.2. |

### The pattern CGI runs before login and takes no input

The CGI is unauthenticated because the pattern paints before login. It takes no input.

It serves the one constant file `/etc/footstrap/pattern.svg` under two headers:

- `Content-Security-Policy: default-src 'none'; sandbox`
- `X-Content-Type-Options: nosniff`

So the SVG opened directly runs no script with the admin's session.

### The rpcd ACL grants exactly this list

The ACL file is the only file in `acl.d`. It grants exactly:

- read: uci `footstrap`;
- write: uci `footstrap`; ubus `uci` `set` and `commit`; ubus `file` `remove`; `cgi-io` `upload`; `file` `write` and `remove` on `/etc/footstrap/login-bg` and `/etc/footstrap/pattern.svg`.

There is no `exec` grant: `cgi-io` sets the uploaded file's mode itself (`filemode`).

Rule: a change to the ACL file is a change to this list, and the other way round.
Why: CI's `build` job checks the ACL file against a literal in `.github/workflows/build.yml`, in the step "The ACL grants exactly this step's literal, which SECURITY.md lists". That literal is the source of truth; this list is kept in sync with it by hand.

### Uploads are inspected in the browser

Appearance accepts a login background and a pattern tile. Both are inspected in the browser:

- an SVG is parsed and cleaned;
- a photo is redrawn on a canvas, which also drops EXIF.

Both land under `/etc/footstrap`.
The login background is reached from `/www` through a symlink.
The pattern has no symlink and is served only by the CGI above.

### The browser JS writes innerHTML in five places

| Use | Where |
|---|---|
| `innerHTML`: one string built from literals and the theme's own icon table | `fs-chrome.js` |
| `innerHTML`: four writes that empty an element | `fs-chrome.js` (three), `fs-search.js` (one) |
| `DOMParser`: parses one string, the uploaded SVG, to inspect and clean it | `fs-assets.js` |

No lint rule holds this; review does.

## Out of scope

- Anything requiring an existing root shell on the router. Writing `/etc/config/footstrap` by hand is a root action, and the template sanitises it anyway.
- The behaviour of third-party `luci-app-*` packages the theme only styles.

## What we do on our side

The maintainer reads the diff of every release for security before the tag is cut. Nothing automates that review.

CI installs each build on a real 25.12/apk and a real 24.10/opkg userland (`tools/e2e.mjs`).
It upgrades the last release to the build, opens every menu page and removes the package again.
