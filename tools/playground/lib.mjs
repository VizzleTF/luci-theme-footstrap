/* Pure functions the playground pipeline runs on both sides of the router: capture.mjs uses
 * `requestKey`/`stableStringify` to file a response away, replay.js uses the SAME key shape
 * (duplicated there — a classic script, no ESM) to find it again, and build.mjs uses everything
 * else to turn a recording into a servable tree. Nothing here touches a filesystem or a browser,
 * which is what makes it testable without either. `resolveUnderRoot` is the one exception that
 * imports `node:path`, still pure in the sense that matters here: no `fs` call, no network.
 *
 * `L.env.sessionid`/`token`/`rollback_token` are 32-hex ubus/CSRF tokens; luci-base's
 * `footer.ut` emits a rollback token of the same shape when a change is pending. `scrubTokens`
 * treats any such literal as a secret rather than tracking each field by name, because a token can
 * appear anywhere the server chose to print it, not only inside `new LuCI({...})`. */
import { resolve, relative, isAbsolute } from 'node:path';

/* JSON with object keys sorted, so two calls that differ only in argument ORDER produce the SAME
 * recording key. Arrays keep their order: `['a','b']` and `['b','a']` are different ubus calls. */
export function stableStringify(value) {
	if (Array.isArray(value))
		return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/* `object.method(args)` — one recording slot per distinct ubus call, `id` and `sid` never part of
 * it: both change on every page load and neither selects which answer a call wants. */
export function ubusKey(object, method, args) {
	return `${object}.${method}(${stableStringify(args ?? {})})`;
}

/* One JSON-RPC request entry (a batch element or the whole body) -> its recording key.
 *
 * `rpc.js`'s `call()` always sends `{jsonrpc,id,method:'call',params:[sid,object,method,args]}`;
 * the one exception is `probeRPCBaseURL()`'s boot probe, `{id:'init',method:'list',params:undefined}`
 * (luci.js), which carries no object/method pair of its own and gets the fixed key `list()`. */
export function requestKey(entry) {
	if (entry && entry.method === 'call' && Array.isArray(entry.params)) {
		const [, object, method, args] = entry.params;
		return ubusKey(object, method, args);
	}
	return `${(entry && entry.method) || ''}()`;
}

/* A ubus POST body, batched (an array, `luci.js`'s `flushRequestQueue`) or not, split into its
 * calls in REQUEST ORDER — position is what a batched reply is matched back to, so order must
 * survive the split even though the recording itself is keyed, not positional. */
export function splitBatch(bodyText) {
	const parsed = JSON.parse(bodyText);
	const entries = Array.isArray(parsed) ? parsed : [parsed];
	return entries.map((entry) => ({ entry, key: requestKey(entry) }));
}

/* `"/cgi-bin/…` and `"/luci-static/…` (or `'…`), wherever a quote sits directly against the
 * prefix, get `base` spliced in front. Deliberately does NOT match the escaped `\/cgi-bin\/` form
 * `new LuCI({...})` is serialised with (`replace(json, '/', '\\/')`, header.ut) — a backslash, not
 * a quote, sits in front of those, so `rewriteEnv` below owns that block instead. */
const PREFIX_RE = /(["'])(\/(?:cgi-bin|luci-static)\/)/g;
export function rewriteBase(html, base) {
	return html.replace(PREFIX_RE, (_m, q, p) => `${q}${base}${p}`);
}

/* The 32-hex secrets a LuCI page ever prints literally: `sessionid`, `token`, `rollback_token`
 * (`new LuCI({...})`, header.ut) and the rollback confirm call's own token (luci-base footer.ut,
 * only emitted while a change is pending). One fixed stub for all of them — the replay shim never
 * checks a session, so what the stub SAYS does not matter, only that a recording never ships a
 * real one. */
export const TOKEN_STUB = '0'.repeat(32);
const TOKEN_RE = /\b[0-9a-f]{32}\b/g;
export function scrubTokens(text) {
	return text.replace(TOKEN_RE, TOKEN_STUB);
}

/* The stand's own `host:port` (what `page.goto()` used to reach it) — never in a served path or
 * env value, only in text a page might have echoed back (e.g. an absolute link). Dropped outright
 * rather than templated: nothing downstream needs to know what stand made the recording. */
export function scrubHost(text, host) {
	if (!host) return text;
	return text.split(host).join('playground.invalid');
}

/* `scrubTokens`/`scrubHost` above only ever ran over the HTML DOCUMENT (build.mjs's `buildPage`);
 * `buildInject` inlines the recorded ubus answers and menu tree as `window.__pgRPC`/`__pgMenu`
 * verbatim, so a 32-hex session token or the stand's `host:port` sitting inside that JSON — not
 * baked into the page text, only into the DATA — shipped to the built site unscrubbed. Recurses
 * into object KEYS as well as values: `network.getHostHints({})` keys its answer by MAC, not a
 * shape either scrub touches, but a key is still a string the recording chose, same as a value. */
export function scrubDataDeep(value, host) {
	if (typeof value === 'string') return scrubHost(scrubTokens(value), host);
	if (Array.isArray(value)) return value.map((v) => scrubDataDeep(v, host));
	if (value && typeof value === 'object') {
		const out = {};
		for (const k of Object.keys(value)) out[scrubDataDeep(k, host)] = scrubDataDeep(value[k], host);
		return out;
	}
	return value;
}

/* The fail-closed guard build.mjs runs over every text file it WROTE, not over a value on its way
 * in — a place `scrubDataDeep`/`scrubTokens`/`scrubHost` were both called correctly still ships
 * exactly what a call site missed, and this is the one check downstream of every call site at
 * once. `tokens` excludes `TOKEN_STUB` itself: the stub is the scrubbed answer, not a leak. */
export function findSecrets(text, host) {
	const reasons = [];
	const tokens = text.match(/\b[0-9a-f]{32}\b/g) || [];
	if (tokens.some((t) => t !== TOKEN_STUB)) reasons.push('a session-token-shaped 32-hex literal');
	if (host && text.includes(host)) reasons.push(`the stand host "${host}"`);
	return reasons;
}

/* Kept pure (no `fs`) so a planted token is a unit test, not a build run: `files` is
 * `[[relPath, text], ...]`, shaped by build.mjs from every text file it wrote under `--out`.
 * Throws naming the first offender rather than collecting all of them — one is already a
 * ship-stopper, and the message is what a CI log needs to point at the file. */
export function guardNoSecrets(files, host) {
	for (const [ rel, text ] of files) {
		const reasons = findSecrets(text, host);
		if (reasons.length)
			throw new Error(`playground/build: ${rel} still carries ${reasons.join(' and ')} — refusing to ship it`);
	}
}

/* verify.mjs's static server joined a decoded request path onto `outDir` and checked the STRING
 * with `startsWith()` — a `{base}/../../etc/passwd` pathname passes that check (the string still
 * starts with base) and only escapes once `join()` normalises the `../` segments, which is exactly
 * what the string compare never saw. `rel` is the request path already stripped of `--base`
 * (verify.mjs's job); returns the resolved file path if it stays inside `rootDir`, `null` if it
 * would escape it or carries a NUL byte (a filesystem call would otherwise choke on that byte, not
 * refuse it cleanly). Pure — no `fs` — so the traversal case is a unit test, not an HTTP request. */
export function resolveUnderRoot(rootDir, rel) {
	if (rel.includes('\0')) return null;
	const root = resolve(rootDir);
	const target = resolve(root, `.${rel}`);
	const fromRoot = relative(root, target);
	if (fromRoot !== '' && (fromRoot.startsWith('..') || isAbsolute(fromRoot))) return null;
	return target;
}

/* Whole-string literal swap, no-op on an empty `from`, an unset `to` (`null`/`undefined` — an empty
 * STRING is a legitimate target, deleting the literal outright) or a pair that already agrees.
 * `rewriteHostname` below is one caller; build.mjs's `buildPage` is the other, for text baked into
 * a page at capture time that no ubus overlay entry reaches (footer.ut's `version.luciname`, the
 * password notice). */
export function rewriteLiteral(html, from, to) {
	if (!from || to == null || from === to) return html;
	return html.split(from).join(to);
}

/* Whether a stored `fs-pg-return` path (`replay.js`'s login gate) is safe to send the reader back
 * to: an admin page this playground can actually serve, under `base`, with no traversal. This is
 * a UI nicety on a static site, not an access check — `replay.js` accepts any form submission — so
 * the failure mode it closes is a stray return path landing the reader somewhere odd, not a
 * redirect a real login could be tricked into. Duplicated verbatim in `replay.js` (a classic
 * script, no module graph), the same way `stripBase` is. */
export function isSafeReturn(path, base) {
	if (typeof path !== 'string') return false;
	const prefix = `${base}/cgi-bin/luci/admin/`;
	if (!path.startsWith(prefix)) return false;
	if (path.includes('//') || path.includes('..') || path.includes('\\')) return false;
	return true;
}

/* Baked into the document at capture time by header.ut's server-side `ubus.call('system','board')`
 * (the `<title>`, `.fs-title-main`, the brand partial — head.ut:149, header.ut:173) and never
 * re-fetched client-side on a settled page, so the overlay's `system.board({}).hostname` patch
 * alone never reaches these bytes. Replaces every literal occurrence of the RECORDED hostname with
 * the overlay's one, text-wide. */
export function rewriteHostname(html, from, to) {
	return rewriteLiteral(html, from, to);
}

/* The same swap, run over the DATA `build.mjs` inlines as `window.__pgRPC` instead of the document
 * text: `system.board({}).hostname` is one field, but `uci.get`'s own `system` config, hosthints
 * and a `system.info`-style ps snapshot all echo the stand's hostname back too, so the built page
 * still names the real stand under an overlay that changed it. Recurses the way `stripBase` does. */
export function rewriteHostnameInData(value, from, to) {
	if (!from || !to || from === to) return value;
	if (typeof value === 'string') return value.split(from).join(to);
	if (Array.isArray(value)) return value.map((v) => rewriteHostnameInData(v, from, to));
	if (value && typeof value === 'object') {
		const out = {};
		for (const k of Object.keys(value)) out[k] = rewriteHostnameInData(value[k], from, to);
		return out;
	}
	return value;
}

/* `env.resource`/`env.documentroot` feed `L.fspath()` (luci.js:2798), which some boot probes
 * (`probePreloadClasses`) use to build a `file.list({path:...})` argument. `rewriteEnv` prefixes
 * BASE onto `resource`, so that path carries BASE at replay time even though the recording was
 * made before the rewrite — this strips every occurrence of BASE back out of a string (recursing
 * into arrays/objects) so a replay lookup's key matches the one the recording was keyed under. */
export function stripBase(value, base) {
	if (!base) return value;
	if (typeof value === 'string') return value.split(base).join('');
	if (Array.isArray(value)) return value.map((v) => stripBase(v, base));
	if (value && typeof value === 'object') {
		const out = {};
		for (const k of Object.keys(value)) out[k] = stripBase(value[k], base);
		return out;
	}
	return value;
}

/* `<` is the only byte a JSON literal can carry that means something inside an inline `<script>`
 * body — `</script` ends the element early, `<!--` opens a comment the parser then swallows the
 * rest of the blob into. `<` is the standard JSON escape for it and `JSON.parse` reads it
 * back as `<` unchanged; JSON's grammar has no bare `<` token, so every `<` a `JSON.stringify`
 * result carries is already inside a string, and safe to replace unconditionally. */
export function jsonForScript(value) {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

/* Find the balanced `{...}` starting at `text[openIdx]` (which must be `{`), respecting JSON
 * string quoting so a brace or quote INSIDE a value never ends the scan early. Returns null if the
 * text ends before the braces close. */
function extractBalanced(text, openIdx) {
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = openIdx; i < text.length; i++) {
		const c = text[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === '\\') esc = true;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') { inStr = true; continue; }
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return text.slice(openIdx, i + 1);
		}
	}
	return null;
}

/* Rewrites the `new LuCI({...})` env object (header.ut:10-30) in place: `scriptname` and
 * `resource` get `base` prefixed the same way a path in the document does, `ubuspath` becomes
 * `base + '/ubus/'` so the replay shim's own route matches it, and `media` (when present) gets
 * `base` too since it is a `/luci-static/…` path like `resource`. The object is re-escaped with
 * `replace(json, '/', '\\/')` exactly like header.ut, so nothing downstream can tell the
 * difference from a live-served page. A page with no `new LuCI(` block (none of the pages this
 * pipeline records lack one) is returned unchanged. */
export function rewriteEnv(html, base) {
	const marker = 'new LuCI(';
	const idx = html.indexOf(marker);
	if (idx === -1) return html;
	const openIdx = idx + marker.length;
	if (html[openIdx] !== '{') return html;
	const escaped = extractBalanced(html, openIdx);
	if (!escaped) return html;
	const env = JSON.parse(escaped.replace(/\\\//g, '/'));
	if (typeof env.scriptname === 'string') env.scriptname = base + env.scriptname;
	if (typeof env.resource === 'string') env.resource = base + env.resource;
	if (typeof env.media === 'string') env.media = base + env.media;
	env.ubuspath = `${base}/ubus/`;
	const reescaped = JSON.stringify(env).replace(/\//g, '\\/');
	return html.slice(0, openIdx) + reescaped + html.slice(openIdx + escaped.length);
}

/* `ls -1`'s stdout (`capture.mjs`'s `listStaticDir`, an `owlab exec` run over a stand's own shell —
 * uhttpd serves no directory index, so the shell is the only thing that can enumerate one) into
 * filenames: a trailing blank line from the final newline dropped, nothing else assumed about what
 * a stand's `ls` prints. Pure so it is the one part of that enumeration a stand-less run can check. */
export function parseLsLines(out) {
	return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/* Recursively lays `patch` over `base`: a nested object merges key by key, an array or a scalar
 * replaces its counterpart outright (there is no sane element-wise merge for a station list). The
 * wireless overlay needs this: `luci-rpc.getWirelessDevices({}).radio0` is a whole config+interfaces
 * object one level below the key the overlay names, and a shallow merge there would drop
 * `interfaces`/`config` the moment it corrected `up`. */
function deepMerge(base, patch) {
	if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
	const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
	for (const k of Object.keys(patch)) out[k] = deepMerge(out[k], patch[k]);
	return out;
}

/* One ubus response, patched by the overlay: `replace` swaps the whole `result` payload,
 * `merge` deep-merges it on top of the recorded one (`deepMerge` above). Either way the ubus
 * success envelope (`result: [0, payload]` — ubus's own [errcode, data] shape, `rpc.js`'s
 * `handleCallReply`) is kept so the replay shim answers exactly the frame `rpc.js` already knows
 * how to unwrap. */
function patchResult(recorded, patch) {
	const prevPayload = Array.isArray(recorded?.result) ? recorded.result[1] : recorded?.result;
	if ('replace' in patch)
		return { ...recorded, result: [0, patch.replace] };
	if ('merge' in patch)
		return { ...recorded, result: [0, deepMerge(prevPayload || {}, patch.merge)] };
	throw new Error('playground overlay: entry needs "replace" or "merge"');
}

/* Applies `overlay.json` on top of a recording's `rpc.json`. A key the overlay names but the
 * recording never saw is a build error, not a silent no-op: the whole point of the overlay is a
 * FEW named corrections on top of what the stand actually answered (a container has no Wi-Fi
 * radio, no WAN port to light up), and a key that stops matching a live recording is the overlay
 * going stale in exactly the way that would otherwise ship unnoticed. */
export function applyOverlay(rpc, overlay) {
	const out = { ...rpc };
	for (const [key, patch] of Object.entries(overlay || {})) {
		if (!(key in out))
			throw new Error(`playground overlay: recording has no entry for "${key}"`);
		out[key] = patchResult(out[key], patch);
	}
	return out;
}

/* Prunes a `admin/menu` tree (`action_menu`, luci-base's `dispatcher.uc:153` — the raw
 * `build_pagetree()` result, `admin` itself as the sole top-level child, not scrubbed down to its
 * subtree) down to the recorded pages and their ancestors, so the built menu carries no link the
 * playground cannot answer. `paths` are slash-joined exactly as `pages.json` has them, `admin/`
 * included — that segment IS a real level of this tree. */
export function pruneMenu(menu, paths) {
	const keep = new Set();
	for (const raw of paths) {
		const segs = raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
		let acc = '';
		for (const seg of segs) {
			acc = acc ? `${acc}/${seg}` : seg;
			keep.add(acc);
		}
	}
	const prune = (node, prefix) => {
		if (!node || typeof node !== 'object' || !node.children) return node;
		const children = {};
		for (const name of Object.keys(node.children)) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (keep.has(path)) children[name] = prune(node.children[name], path);
		}
		return { ...node, children };
	};
	return prune(menu, '');
}
