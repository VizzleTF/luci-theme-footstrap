'use strict';
'require baseclass';
'require rpc';
'require fs-axes as axes';

/* fs-assets — putting a file ON THE ROUTER, and taking it off again.
 *
 * Two uploads live here, the pattern tile and the login photo, and everything they need that the
 * rest of the theme does not: a DOMParser pass over an SVG, a canvas re-encode of a photo, the
 * chmod that makes a freshly written 0600 file servable, and the rollback that runs when the token
 * write fails after the bytes have landed.
 *
 * It is a module of its own because of WHERE it is needed: this machinery is reached only from the
 * Appearance tab, one page out of nearly two hundred, and it was ~4 KB of DOMParser, canvas and rpc
 * plumbing downloaded to a router's browser on the way to the DHCP page.
 *
 * The token accessors and the two live appliers live in `fs-axes` beside the axes themselves — the
 * Appearance previews and head.ut's pre-paint read the same fields — so this file requires that one
 * and nothing else of the theme's. */

/* `reject: true` is load-bearing: without it a refused write arrives as SUCCESS. rpc.js raises on
 * the ubus status code only when the declaration asks it to, and otherwise hands the code back as
 * the resolved value — measured on the router, a per-config ACL refusal resolves with 6
 * (permission denied) and every `.then()` below runs as if the file had been written, greying the
 * Save button over a write that never happened. */
/* The four messages each said twice or three times below. Hoisted because a string literal is not
 * mangled, so every repeat is paid in full on flash — and because a message with two spellings is a
 * message that gets fixed in one of them. The msgid and its 'footstrap' context stay literal
 * arguments here, which is what update-po.sh's extractor reads. */
const MSG_UPLOAD_FAILED = _('Upload failed.', 'footstrap');
const MSG_NOT_SVG = _('That file is not an SVG image.', 'footstrap');
const MSG_BAD_IMAGE = _('Could not process the image.', 'footstrap');
const MSG_PICK_SVG = _('Please choose an SVG file.', 'footstrap');

const _uciSet = rpc.declare({ object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ], reject: true });
const _uciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ], reject: true });

/* ---- the pattern: an SVG the admin uploads, tiled and recoloured ----
 *
 * The bytes come from the admin, never from a third-party host: a theme in a package feed does not
 * reach out at run time.
 *
 * Router-side, like the login photo and for the same reason — a file cannot live in localStorage,
 * and a pattern is something a router wears. The path is a fixed server-side constant matched
 * exactly by the rpcd ACL, so nothing user-controlled reaches a path. It lives under /etc so a
 * package upgrade cannot delete it (keep.d carries it across a sysupgrade), and the served name
 * ends in .svg because uhttpd types a file by extension.
 *
 * How it is made to fit is 15-wallpaper.css's mask, not anything done to the bytes: the file
 * supplies the alpha and the theme the colour, so one upload reads correctly in both modes and
 * under every palette.
 *
 * What is refused: an SVG is a document, not a picture, and while a masked or background image
 * never executes script, the same file fetched from its own URL would. Uploading already needs an
 * authenticated admin session with uci write rights, so this is defence in depth — but the check is
 * cheap and the failure mode is somebody else's browser. */
const PAT_PATH  = '/etc/footstrap/pattern.svg';			/* cgi-upload target; the ACL grants exactly this */
const PAT_MAX   = 512 * 1024;							/* a tile that has to reach a router's flash and then every page load */
/* What makes an uploaded SVG unacceptable, decided on the PARSED document and not on its text: a
 * regex over the source guesses at a grammar the browser already implements, and guesses in both
 * directions — a handler pattern also matches an ordinary `only_selected="false"`, while an entity
 * or odd whitespace hides a real handler from it.
 *
 * DOMParser is the parser the file will actually be read by, and parsing is inert: no script runs,
 * no subresource is fetched, no handler is bound. So the questions are exact ones about nodes:
 *
 *   - is it an SVG at all (a parsererror, or a root that is not <svg>, is not an image)
 *   - does it carry an element that executes or embeds (script, foreignObject, iframe, …)
 *   - does it carry a real event-handler attribute — `^on[a-z]+$`
 *   - does any value start a `javascript:` url
 *   - does any href point off this router; `#fragment` and `data:` stay allowed, being how a tile
 *     refers to its own <defs> and embeds a bitmap
 *
 * The check is for the way the file can be reached that a mask does not cover: its own URL, opened
 * directly, same-origin with the session.
 *
 * `animate`/`set` are listed for a second reason as well: they can retarget an attribute at run
 * time (`<set attributename="href" to="javascript:…">`), and a tile that animates repaints a
 * full-viewport layer behind every page. */
const PAT_BAD_TAGS = [ 'script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'animate', 'set' ];
const SVG_NS = 'http://www.w3.org/2000/svg';

/* null if the parsed document is fine, otherwise the sentence to show. */
function _svgObjection(text) {
	let doc;
	try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); }
	catch (e) { return MSG_NOT_SVG; }
	const root = doc && doc.documentElement;
	/* An SVG is its ROOT'S NAMESPACE, not its root's spelling. `nodeName` is the qualified name, so
	 * it answers both questions wrong at once: `<svg xmlns="http://www.w3.org/1999/xhtml">` reads as
	 * `svg` and is admitted although it is an XHTML document that executes on all three engines,
	 * while `<s:svg xmlns:s="http://www.w3.org/2000/svg">` reads as `s:svg` and is turned away
	 * although it is an ordinary picture. */
	if (!root || doc.querySelector('parsererror') ||
		root.localName.toLowerCase() !== 'svg' || root.namespaceURI !== SVG_NS)
		return MSG_NOT_SVG;
	const refused = _('That SVG contains script or external references, which this theme will not install.', 'footstrap');
	/* A processing instruction can attach an XSLT stylesheet carried INSIDE this same document, and
	 * the transform's output is a document this walk never sees: `<xsl:element name="script">`
	 * builds the element by name, so nothing here is called script. Measured executing on Firefox
	 * (Chromium and WebKit decline to run XSLT on an image/svg+xml document). A tile has no use for
	 * one, and without the PI the embedded stylesheet is never applied. */
	for (const n of doc.childNodes) if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE) return refused;
	const els = [ root ].concat([ ...root.querySelectorAll('*') ]);
	for (const el of els) {
		/* localName, never nodeName: in an XML document nodeName carries the namespace PREFIX, so
		 * `<s:script xmlns:s="http://www.w3.org/2000/svg">` reads as `s:script` and walks straight
		 * past a list of names — measured executing on all three engines, as does the same element
		 * put in the xhtml namespace. localName is `script` for every one of those spellings. */
		if (PAT_BAD_TAGS.indexOf((el.localName || el.nodeName).toLowerCase()) >= 0) return refused;
		const attrs = el.attributes || [];
		for (let i = 0; i < attrs.length; i++) {
			const n = attrs[i].name.toLowerCase();
			const v = String(attrs[i].value || '').trim();
			/* a REAL handler is `on` + letters and nothing else; `only_selected` is not one. The
			 * qualified name is right here, unlike on the element above: a prefixed `s:onload` or
			 * `xlink:onload` fires on none of the three engines, so matching localName would only
			 * refuse files that do nothing. */
			if ((/^on[a-z]+$/).test(n)) return refused;
			if ((/^javascript:/i).test(v)) return refused;
			/* off-router reference. A leading `//` is protocol-relative and just as external. */
			if ((/(?:^|:)href$/).test(n) && (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i).test(v)) return refused;
		}
	}
	return null;
}

/* read the picked file as text so it can be inspected before upload, and so what reaches the
 * router is exactly the bytes that were checked */
function _readText(file) {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result || ''));
		fr.onerror = () => reject(new Error(_('That file could not be read.', 'footstrap')));
		fr.readAsText(file);
	});
}

/* ---- login/page background upload: router-side, and deliberately not an axis ----
 * The other axes are per-browser with a router default; this one has no browser layer. An admin
 * uploads an image once, it becomes the router-wide background for every device and shows
 * pre-login, so it is absent from AXIS_KEYS, snapshotAxes() and matchesSavedDefault() — it must not
 * move the Save button — and needs no factory, so tools/axes.mjs never sees it.
 *
 * The image is a served file, uhttpd having no gzip to make inlining it in every <head> viable;
 * only its cache-bust token lives in uci -> window.__fsSD -> the url() head.ut stamps. The path is
 * a fixed server-side constant matched exactly by the rpcd ACL, so nothing user-controlled reaches
 * a path. */
const BG_PATH  = '/etc/footstrap/login-bg';		/* cgi-upload target; the ACL grants exactly this */
const BG_MAX_SIDE = 1920;						/* cap the longest side — a router serves this off flash with no gzip, and 1080p covers the screens LuCI is actually admin'd from; still crisp full-screen, far fewer flash/wire bytes */
const BG_QUALITY  = 0.9;
const BG_SRC_MAX  = 25 * 1024 * 1024;			/* refuse a source this big before decoding (decode-bomb guard) */
/* No `reject: true` here, unlike every other declare in this file: with it, "the file was already
 * gone" and "the router refused to delete it" arrive as the same Error. Without it the promise
 * resolves with the ubus status as a number, which this code can branch on. */
const _fileRemoveStatus = rpc.declare({ object: 'file', method: 'remove', params: [ 'path' ] });

/* Delete, treating "not found" as done. Anything else is a real refusal (a read-only or full
 * overlay, an immutable flag, a path replaced by a directory) and must not be reported as a
 * removal: the file stays on flash and stays fetchable WITHOUT a session through the /www symlink,
 * which is what an admin removing a background believes they have stopped. */
const UBUS_NOT_FOUND = 4;
function _removeServed(path) {
	return _fileRemoveStatus(path).then((res) => {
		const code = (typeof res === 'number') ? res : parseInt(res, 10);
		if (code === 0 || code === UBUS_NOT_FOUND || isNaN(code)) return;
		return Promise.reject(new Error(
			_('The router refused to delete the file (ubus status %d).', 'footstrap').format(code)));
	});
}
/* cgi-upload writes the file 0600 and uhttpd refuses to serve a file that is not world-readable
 * (0600 -> 403, 0644 -> 200), so make it 0644 first. The rpcd ACL grants exec on exactly two fixed
 * commands — chmod 644 on the two files this module uploads — with no caller-controlled
 * argument. */
const _fileExec = rpc.declare({ object: 'file', method: 'exec', params: [ 'command', 'params' ], reject: true });
/* …and the ubus status is only half of it: `file.exec` reports the command's exit status inside the
 * payload, so a chmod that ran and failed still comes back as a successful call — and the upload
 * then reports success for a file uhttpd will 403, leaving every device a scrim over nothing. */
function _chmodServeable(path) {
	return _fileExec('/bin/chmod', [ '644', path ]).then((res) => {
		if (res && res.code)
			throw new Error(MSG_UPLOAD_FAILED + ' (chmod ' + res.code + ')');
		return res;
	});
}
/* Re-encode the picked image to a bounded JPEG on a canvas. A security step as much as a size one:
 * the canvas keeps only the decoded pixels, so EXIF and any bytes appended past the image are
 * dropped and the uploaded blob is exactly what the browser drew.
 *
 * The whole body is guarded, because a throw inside an event handler does not reject the promise it
 * sits in — it escapes as an uncaught error and leaves the promise pending forever. Two real ways
 * out of `onload`: `getContext('2d')` answers null when the canvas cannot be backed, and
 * drawImage/toBlob can throw. A pending promise leaves the caller's "Uploading…" button disabled
 * and lying until the form is rebuilt on a later arrival at the page. */
function _downscale(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			try {
				const scale = Math.min(1, BG_MAX_SIDE / Math.max(img.width, img.height));
				const w = Math.max(1, Math.round(img.width * scale));
				const h = Math.max(1, Math.round(img.height * scale));
				const cv = document.createElement('canvas');
				cv.width = w; cv.height = h;
				const ctx = cv.getContext('2d');
				if (!ctx) throw new Error('no 2d context');
				ctx.drawImage(img, 0, 0, w, h);
				cv.toBlob((blob) => blob ? resolve(blob) : reject(new Error(MSG_BAD_IMAGE)),
					'image/jpeg', BG_QUALITY);
			} catch (e) { reject(new Error(MSG_BAD_IMAGE)); }
		};
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(_('That file is not a readable image.', 'footstrap'))); };
		img.src = url;
	});
}

/* An upload that has landed but could not be RECORDED must not stay on the router. The two paths
 * below write the file first and the token second, and the second half can fail on its own (no
 * `settings` section, a narrowed uci ACL, ubus busy) — the image then sits at mode 0644 and is
 * served to anyone through the /www symlink, which does not depend on the token, while Remove is
 * hidden precisely because the token is empty. Roll the file back and report the failure that
 * started it; a rollback that itself fails is appended, because the admin has to know the file is
 * there. */
function _rollbackUpload(path, cause) {
	return _removeServed(path).then(
		() => Promise.reject(cause),
		() => Promise.reject(new Error(String((cause && cause.message) || cause) + ' — '
			+ _('the uploaded file could not be removed either; it is still on the router.', 'footstrap')))
	);
}

/* ---- one upload, two assets ----
 *
 * Both wallpapers travel the same road: refuse what should not be sent, turn the picked file into
 * the bytes that will actually be stored, POST them to cgi-upload, take the md5 `checksum` back as
 * the cache-bust token, make the file servable, write the token to uci, and only then paint it.
 * Every step of that was written out twice, and the two copies had already drifted — one quoted
 * the url() it wrote with `"` and the other with `'`.
 *
 * What genuinely differs is one function: what `prepare` hands back to be uploaded. The SVG is read
 * as text and inspected, because an SVG is a document and the check has to see the parsed tree; the
 * photo is redrawn on a canvas, which both bounds it and drops EXIF, because a raster has nothing
 * to inspect. Everything either side of that is the same road.
 *
 * `rollback` is the reason the order matters. The bytes land before the token does, and the second
 * half can fail on its own — no `settings` section, a narrowed uci ACL, ubus busy — leaving a file
 * at 0644 served through the /www symlink while Remove stays hidden, because Remove keys off the
 * token being non-empty. So a failure after the write takes the file away again. */
function assetAxis(o) {
	const upload = (file) => Promise.resolve()
		.then(() => o.prepare(file))
		.then((blob) => {
			const fd = new FormData();
			fd.append('sessionid', rpc.getSessionID());
			fd.append('filename', o.path);
			fd.append('filedata', blob, o.filename);
			return fetch(L.env.cgi_base + '/cgi-upload',
				{ method: 'POST', body: fd, credentials: 'same-origin' })
				.then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
		})
		.then((reply) => {
			/* cgi-upload answers { name, size, checksum, sha256sum } or { failure: [code, msg] } */
			if (!reply || reply.failure)
				return Promise.reject(new Error((reply && reply.failure && reply.failure[1])
					|| MSG_UPLOAD_FAILED));
			const tok = String(reply.checksum || '').toLowerCase();
			if (!axes.tokenOk(tok)) return Promise.reject(new Error(MSG_UPLOAD_FAILED));
			/* cgi-upload writes 0600 and uhttpd refuses to serve a file that is not world-readable
			 * (0600 -> 403, 0644 -> 200); _chmodServeable checks the command's exit status, not
			 * just the ubus call's */
			return _chmodServeable(o.path)
				/* uci gets the token and nothing else: putting a file on the router is not the same
				 * act as making every other device paint it */
				.then(() => _uciSet('footstrap', 'settings', { [o.field]: tok }))
				.then(() => _uciCommit('footstrap'))
				.catch((e) => _rollbackUpload(o.path, e))
				.then(() => {
					/* switch this browser onto it: the ordinary axis path, localStorage only */
					axes.applyWallpaper(o.wallpaper);
					o.apply(tok);
					return tok;
				});
		});

	/* Remove: delete the file, blank the token (uci `set` to '', not delete — the scoped ACL grants
	 * set/commit only), clear the url() live. */
	const remove = () => _removeServed(o.path)
		.then(() => _uciSet('footstrap', 'settings', { [o.field]: '' }))
		.then(() => _uciCommit('footstrap'))
		.then(() => { o.apply(''); });

	return { upload, remove };
}

/* The tile. No canvas step, which is what strips a photo's EXIF: an SVG redrawn to a canvas comes
 * back a raster, so the parsed-document check above stands in for it. */
const PATTERN = assetAxis({
	path: PAT_PATH, filename: 'pattern.svg', field: 'pattern', wallpaper: 'pattern',
	apply: (tok) => axes.applyPattern(tok),
	prepare: (file) => {
		if (!file) return Promise.reject(new Error(MSG_PICK_SVG));
		const isSvg = (/(^image\/svg\+xml$)/i).test(file.type || '') || (/\.svg$/i).test(file.name || '');
		if (!isSvg) return Promise.reject(new Error(MSG_PICK_SVG));
		if (file.size > PAT_MAX) return Promise.reject(new Error(_('That file is too large.', 'footstrap')));
		return _readText(file).then((text) => {
			const objection = _svgObjection(text);
			if (objection) return Promise.reject(new Error(objection));
			return new Blob([ text ], { type: 'image/svg+xml' });
		});
	}
});

/* The photo. cgi-upload is the endpoint L.ui.uploadFile uses — session in the `sessionid` field,
 * path in `filename`, bytes in `filedata` — and it authorises the write against the ACL's `file`
 * grant for BG_PATH. */
const LOGIN_BG = assetAxis({
	path: BG_PATH, filename: 'login-bg', field: 'login_bg', wallpaper: 'file',
	apply: (tok) => axes.applyLoginBg(tok),
	prepare: (file) => {
		if (!file || !(/^image\//).test(file.type || ''))
			return Promise.reject(new Error(_('Please choose an image file.', 'footstrap')));
		if (file.size > BG_SRC_MAX)
			return Promise.reject(new Error(_('That image is too large.', 'footstrap')));
		return _downscale(file);
	}
});


return baseclass.extend({
	uploadPattern: PATTERN.upload,
	removePattern: PATTERN.remove,
	uploadLoginBg: LOGIN_BG.upload,
	removeLoginBg: LOGIN_BG.remove
});
