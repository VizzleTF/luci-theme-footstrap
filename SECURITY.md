# Security policy

## Reporting a vulnerability

Report privately through GitHub — **Security → [Report a vulnerability](https://github.com/VizzleTF/luci-theme-footstrap/security/advisories/new)**.
If that is unavailable to you, email <vizzlef@gmail.com> with `luci-theme-footstrap` in the
subject. Please do not open a public issue for a suspected vulnerability.

Include what you have:

- the OpenWrt release and package manager (25.12/apk or 24.10/opkg);
- the theme version from *System → Footstrap*;
- the request or the page;
- what an attacker gains.

A proof of concept is welcome but not required.

You will get an acknowledgement within **7 days** and an assessment within **14**. A confirmed fix
ships in the next release; you will be credited in `CHANGELOG.md` unless you ask otherwise.

## Supported versions

| Version | Supported |
|---|---|
| latest release | yes |
| earlier releases | no — upgrade first, then report if it persists |
| 0.14.2 (the last for OpenWrt 23.05) | no. 23.05 is end-of-life upstream |

## What this package can do

The theme is server chrome plus browser assets. It ships no daemon, opens no port and depends on
`luci-base` alone. It adds one menu node, *System → Footstrap* (`admin/system/footstrap`), and one
CGI. The parts worth your attention:

- **The login page.** `ucode/template/themes/footstrap/sysauth.ut` renders *before* a session
  exists, so it is an unauthenticated surface. The form is server-rendered on purpose.
- **The pattern CGI**, `root/www/cgi-bin/luci-theme-footstrap-pattern`. It is unauthenticated (the
  pattern paints before login) and takes no input. It serves the one constant file
  `/etc/footstrap/pattern.svg` under `Content-Security-Policy: default-src 'none'; sandbox` and
  `X-Content-Type-Options: nosniff`. So the SVG opened directly runs no script with the admin's
  session.
- **The rpcd ACL**, `root/usr/share/rpcd/acl.d/luci-theme-footstrap.json`, the only file in
  `acl.d`. It grants exactly:
  - read: uci `footstrap`;
  - write: uci `footstrap`; ubus `uci` `set` and `commit`; ubus `file` `remove`; `cgi-io`
    `upload`; `file` `write` and `remove` on `/etc/footstrap/login-bg` and
    `/etc/footstrap/pattern.svg`.

  No `exec` grant: `cgi-io` sets the uploaded file's mode itself (`filemode`). CI's `build` job
  holds the file to this list (step "The ACL grants exactly this step's literal, which SECURITY.md
  lists"); a change to one is a change to both.
- **The uploads.** Appearance accepts a login background and a pattern tile. Both are inspected in
  the browser (an SVG is parsed and cleaned, a photo is redrawn on a canvas, which also drops EXIF)
  and land under `/etc/footstrap`. The login background is reached from `/www` through a symlink;
  the pattern has no symlink and is served only by the CGI above.
- **The browser JS.** `innerHTML` is written in five places: one string built from literals and
  the theme's own icon table (`fs-chrome.js`), and four that empty an element. `DOMParser` parses
  one string, the uploaded SVG, to inspect and clean it (`fs-assets.js`). No lint rule holds this;
  review does.
- **The installer**, `install.sh`, verifies a usign signature and a checksum before it installs
  anything, and pins 23.05 routers to 0.14.2.

Out of scope:

- anything requiring an existing root shell on the router. Writing `/etc/config/footstrap` by hand
  is a root action, and the template sanitises it anyway.
- the behaviour of third-party `luci-app-*` packages the theme only styles.

## What we do on our side

The maintainer reads the diff of every release for security before the tag is cut; nothing
automates that review. CI installs each build on a real 25.12/apk and a real 24.10/opkg userland
(`tools/e2e.mjs`). It upgrades the last release to the build, opens every menu page and removes the
package again.
