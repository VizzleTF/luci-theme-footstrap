/* The playground's runtime half: answers every ubus/menu/upload call the built page makes, from
 * the data pg-data.js defines ahead of this tag (`window.__pgRPC`, `window.__pgMenu`) — nothing
 * here reaches a network. A CLASSIC script, not a module, and injected BEFORE luci.js on purpose:
 * XMLHttpRequest and fetch must already be patched when luci.js's own boot sequence makes its
 * first request, not after.
 *
 * `/luci-static/**` is never touched. `requestKey`/`ubusKey`/`stripBase`/`isSafeReturn` are
 * lib.mjs's own functions, written into pg-data.js by build.mjs (one global scope), not copies; a
 * drifted key answers nothing. A miss lands in `window.__pgMiss` and
 * gets a JSON-RPC error, except `session.access`, which fs-router.js reads as "log in again", so
 * it answers `true`. The login gate imitates being logged out and does not enforce it: the site
 * is static, so the form on `window.__pgPage === 'login'` accepts any credentials, on purpose. */
(function () {
	'use strict';

	window.__pgMiss = window.__pgMiss || [];

	const RPC = window.__pgRPC || {};
	const MENU = window.__pgMenu || { children: {} };
	const BASE = window.__pgBase || '';
	const PAGE = window.__pgPage || 'view';
	const OVERVIEW = window.__pgOverview || `${BASE}/cgi-bin/luci/`;
	const LOGIN_URL = `${BASE}/cgi-bin/luci/`;

	/* Every page but the login form is gated on a sessionStorage flag: no flag sends the reader to
	 * the login page, remembering where they were headed in `fs-pg-return` so the submit handler
	 * below can send them back. Runs first and returns out of the whole file when it fires — the
	 * fetch/XHR patching below would answer calls on a document that is already navigating away. */
	if (PAGE !== 'login' && !window.sessionStorage.getItem('fs-pg-auth')) {
		window.sessionStorage.setItem('fs-pg-return', location.pathname + location.search);
		location.replace(LOGIN_URL);
		return;
	}

	/* `form.fs-login` (sysauth.ut) does not exist yet when this script runs — it sits in `<head>`,
	 * ahead of the body the server-rendered form is part of — so the submit listener has to wait
	 * for DOMContentLoaded rather than attach right away. */
	if (PAGE === 'login') {
		document.addEventListener('DOMContentLoaded', () => {
			const form = document.querySelector('form.fs-login');
			if (!form) return;
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				window.sessionStorage.setItem('fs-pg-auth', '1');
				const stored = window.sessionStorage.getItem('fs-pg-return');
				location.replace(isSafeReturn(stored, BASE) ? stored : OVERVIEW);
			});
		});
	}

	/* uci writes the theme's "Save to router"/"Save & Apply" issue (fs-axes.js, ui.js's own apply
	 * flow) never had a chance to run on the stand at capture time, so no recording can answer
	 * them; faking success here is what keeps those buttons from erroring out in the playground. */
	const FAKE_SUCCESS = new Set([
		'uci.set', 'uci.add', 'uci.delete', 'uci.rename', 'uci.order',
		'uci.commit', 'uci.revert', 'uci.confirm',
		'uci.apply_unchecked', 'uci.apply_rollback',
	]);

	function answerEntry(entry) {
		const key = requestKey(entry, BASE);
		const recorded = RPC[key];
		if (recorded) return { ...recorded, id: entry.id, jsonrpc: '2.0' };

		if (entry.method === 'call' && Array.isArray(entry.params)) {
			const object = entry.params[1], method = entry.params[2];
			if (`${object}.${method}` === 'session.access')
				return { jsonrpc: '2.0', id: entry.id, result: [ 0, true ] };
			if (FAKE_SUCCESS.has(`${object}.${method}`))
				return { jsonrpc: '2.0', id: entry.id, result: [ 0, {} ] };
		}
		if (entry.method === 'list')
			return { jsonrpc: '2.0', id: entry.id, result: {} };

		window.__pgMiss.push({ key, method: entry.method });
		return { jsonrpc: '2.0', id: entry.id, error: { code: -32000, message: 'not recorded in this playground' } };
	}

	function answerUbus(bodyText) {
		let parsed;
		try { parsed = JSON.parse(bodyText || '{}'); } catch (e) { parsed = {}; }
		if (Array.isArray(parsed)) return JSON.stringify(parsed.map(answerEntry));
		return JSON.stringify(answerEntry(parsed));
	}

	function answerUpload() {
		return JSON.stringify({ name: 'playground-upload', size: 0, checksum: '0'.repeat(32), sha256sum: '0'.repeat(64) });
	}

	/* null when the request is none of ours: the caller lets it through untouched. */
	function route(method, urlStr) {
		let path;
		try { path = new URL(urlStr, location.href).pathname; } catch (e) { return null; }
		if (method === 'GET' && path.endsWith('/admin/menu')) return 'menu';
		if (method === 'POST' && path.endsWith('/ubus/')) return 'ubus';
		if (method === 'POST' && path.endsWith('/cgi-upload')) return 'upload';
		return null;
	}

	/* ---- fetch: a real Response needs no trickery ---- */
	const realFetch = window.fetch;
	window.fetch = function (input, init) {
		const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
		const url = typeof input === 'string' ? input : (input && input.url) || '';
		const kind = route(method, url);
		if (!kind) return realFetch.apply(window, arguments);
		const body = kind === 'ubus' ? answerUbus(init && init.body)
			: kind === 'menu' ? JSON.stringify(MENU) : answerUpload();
		return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
	};

	/* ---- XMLHttpRequest: re-point a matched request at a same-origin blob before it is sent, so
	 * the browser's OWN xhr machinery drives readyState/status/events — luci.js's
	 * `handleReadyStateChange` reads those off the real object, not something this file can fill in
	 * by hand without reimplementing the state machine. */
	const RealXHR = window.XMLHttpRequest;
	const openTag = new WeakMap();
	const realOpen = RealXHR.prototype.open;
	const realSend = RealXHR.prototype.send;

	RealXHR.prototype.open = function (method, url) {
		openTag.set(this, { method: String(method).toUpperCase(), url });
		return realOpen.apply(this, arguments);
	};

	RealXHR.prototype.send = function (body) {
		const tag = openTag.get(this);
		const kind = tag && route(tag.method, tag.url);
		if (!kind) return realSend.apply(this, arguments);

		const text = kind === 'ubus' ? answerUbus(body)
			: kind === 'menu' ? JSON.stringify(MENU) : answerUpload();
		const blobUrl = URL.createObjectURL(new Blob([ text ], { type: 'application/json' }));
		this.addEventListener('loadend', () => URL.revokeObjectURL(blobUrl), { once: true });
		realOpen.call(this, 'GET', blobUrl, true);
		return realSend.call(this);
	};
})();
