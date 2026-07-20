'use strict';
'require baseclass';

/* ---- theme identity: the version footstrap SHIPS, and the repo it came from ----
 *
 * Shown in the Appearance popover's footer with NO network call and NO dependency on the optional
 * updater package (luci-app-footstrap-updater): a router that never installed the updater still sees
 * its own version and the repo link. This module is why the version can show while the whole update
 * machinery is a separate package the theme merely loads at runtime when present.
 *
 * FS_VERSION is stamped at build/deploy: the theme Makefile (Build/Prepare) and dev-sync.sh rewrite
 * the '0.0.0-dev' literal below — BY FILE NAME, so this constant cannot move to another file without
 * changing both seds. An unstamped source checkout stays 'dev'. The updater's fs-update.js reads
 * VERSION back from here to compare against the latest GitHub release. */
const FS_VERSION = '0.0.0-dev';
const FS_REPO = 'VizzleTF/luci-theme-footstrap';

/* The parentheses around the regex are load-bearing — do not "tidy" them away. luci.mk minifies
 * this file with jsmin, whose regex-vs-division test is a ONE-character lookback against a fixed
 * allow-list. `n` (the last letter of `return`) is not on it, so `return /re/` is read as a
 * division and the regex's `//` swallows the rest of the file — exiting 0 (openwrt/luci#8299).
 *
 * The shape of the version is the WHOLE test — do NOT re-add a `FS_VERSION !== '0.0.0-dev'`
 * comparison. CI runs terser over this file BEFORE the Makefile stamps the version, so at that
 * moment both sides of that comparison are the same literal: terser folded it to `&& !1` and
 * every released build reported itself as '(dev)' forever after, with the update check's theme
 * leg (fs-update.js, gated on isReal) silently dead. An SDK/buildbot build has no terser step,
 * so it worked locally and only ever broke in a release. A regex test is not constant-folded —
 * proven by the same minified output, which kept this very `.test()` call — so the sentinel is
 * excluded by its SHAPE instead. `-dev$` and not `^\d+\.\d+\.\d+$`, because dev-sync.sh stamps
 * `git describe` ('0.9.4-12-gabc1234') and that must keep counting as a real version. */
function isReal() { return ((/^\d+\.\d+/).test(FS_VERSION)) && !((/-dev$/).test(FS_VERSION)); }

return baseclass.extend({
	VERSION: FS_VERSION,
	REPO: FS_REPO,
	REPO_URL: 'https://github.com/' + FS_REPO,
	isReal,
	/* what the popover's version row prints */
	label: () => (isReal() ? ('Footstrap v' + FS_VERSION) : 'Footstrap (dev)')
});
