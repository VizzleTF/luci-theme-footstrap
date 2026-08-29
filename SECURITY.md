# Security policy

## Reporting a vulnerability

Report privately through GitHub — **Security → [Report a vulnerability](https://github.com/VizzleTF/luci-theme-footstrap/security/advisories/new)**.
If that is unavailable to you, email <vizzlef@gmail.com> with `luci-theme-footstrap` in the
subject. Please do not open a public issue for a suspected vulnerability.

Include what you have: the OpenWrt release and package manager (25.12/apk or 24.10/opkg), the theme
version from *System → System → Appearance*, the request or the page, and what an attacker gains.
A proof of concept is welcome but not required.

You will get an acknowledgement within **7 days** and an assessment within **14**. A confirmed fix
ships in the next release; you will be credited in `CHANGELOG.md` unless you ask otherwise.

## Supported versions

| Version | Supported |
|---|---|
| latest release | yes |
| earlier releases | no — upgrade first, then report if it persists |
| 0.14.2 (the last for OpenWrt 23.05) | no. 23.05 is end-of-life upstream |

## What this package can actually do

The theme is server chrome plus browser assets. It ships no daemon, opens no port, registers no
dispatcher node and depends on `luci-base` alone. The parts worth your attention:

- **The login page.** `ucode/template/themes/footstrap/sysauth.ut` renders *before* a session
  exists, so it is the one unauthenticated surface. The form is server-rendered on purpose.
- **The rpcd ACL**, `root/usr/share/rpcd/acl.d/luci-theme-footstrap.json`. It grants uci
  read/write on the `footstrap` config, `cgi-io` upload, and `file` write/remove/exec on two fixed
  paths. The two `exec` grants are whole command lines (`/bin/chmod 644 /etc/footstrap/…`), never an
  interpreter — `npm run acl` fails the build if that changes.
- **The uploads.** Appearance accepts a login background and a pattern tile. Both are inspected in
  the browser (an SVG is parsed, a photo is redrawn on a canvas, which also drops EXIF) and land
  under `/etc/footstrap`, reached from `/www` through a symlink.
- **The browser JS.** HTML is parsed from a string in four places, all literal; the
  `fs/no-unsanitized-html` lint rule keeps it that way.
- **The installer**, `install.sh`, verifies a usign signature and a checksum before it installs
  anything, and pins 23.05 routers to 0.14.2.

Out of scope: anything requiring an existing root shell on the router (writing
`/etc/config/footstrap` by hand is a root action, and the template sanitises it anyway), and the
behaviour of third-party `luci-app-*` packages the theme merely styles.

## What we do on our side

Every release and every upstream pull request goes through a security review of the branch diff
before the tag is cut, and CI installs each build on a real 25.12 and a real 24.10 userland.
