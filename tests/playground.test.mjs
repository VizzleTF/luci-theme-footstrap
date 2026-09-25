/* tools/playground/lib.mjs — the pure half of the record-and-replay pipeline. capture.mjs and
 * verify.mjs both need a live owlab stand (T2); this is what proves the deterministic half without
 * one: the recording key a request and a reply agree on, the rewrites build.mjs applies to a
 * captured document, and the overlay/menu edits it makes on top of the recorded JSON. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	stableStringify, ubusKey, requestKey, splitBatch,
	rewriteBase, rewriteEnv, scrubTokens, scrubHost, rewriteHostnameInData,
	rewriteLiteral, stripBase, jsonForScript, applyOverlay, pruneMenu, parseLsLines, TOKEN_STUB,
	scrubDataDeep, findSecrets, guardNoSecrets, resolveUnderRoot, isSafeReturn,
	missingOverlayKeys, waitForQuiet, drainReads, createActivityTracker, createGenerationGate,
	describePendingRequest, describePendingRequests,
} from '../tools/playground/lib.mjs';

test('stableStringify sorts object keys but keeps array order', () => {
	assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
	assert.equal(stableStringify(['b', 'a']), '["b","a"]');
	assert.equal(stableStringify({ b: [1, { d: 1, c: 2 }], a: 1 }), '{"a":1,"b":[1,{"c":2,"d":1}]}');
});

test('ubusKey is stable under argument key order, distinct under value', () => {
	assert.equal(ubusKey('system', 'board', { x: 1, y: 2 }), ubusKey('system', 'board', { y: 2, x: 1 }));
	assert.notEqual(ubusKey('system', 'board', { x: 1 }), ubusKey('system', 'board', { x: 2 }));
	assert.equal(ubusKey('system', 'board'), 'system.board({})');
});

test('requestKey: a `call` entry keys on object.method(args), sid and id play no part', () => {
	const a = { jsonrpc: '2.0', id: 1, method: 'call', params: ['sid-one', 'uci', 'get', { config: 'system' }] };
	const b = { jsonrpc: '2.0', id: 99, method: 'call', params: ['sid-two', 'uci', 'get', { config: 'system' }] };
	assert.equal(requestKey(a), requestKey(b));
	assert.equal(requestKey(a), 'uci.get({"config":"system"})');
});

test('requestKey: the boot `list` probe has no object.method pair', () => {
	assert.equal(requestKey({ jsonrpc: '2.0', id: 'init', method: 'list', params: undefined }), 'list()');
});

test('splitBatch: a single request and a batched array both split by position, in order', () => {
	const single = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: ['s', 'system', 'board', {}] });
	const one = splitBatch(single);
	assert.equal(one.length, 1);
	assert.equal(one[0].key, 'system.board({})');

	const batch = JSON.stringify([
		{ jsonrpc: '2.0', id: 1, method: 'call', params: ['s', 'system', 'board', {}] },
		{ jsonrpc: '2.0', id: 2, method: 'call', params: ['s', 'uci', 'get', { config: 'network' }] },
	]);
	const two = splitBatch(batch);
	assert.equal(two.length, 2);
	assert.deepEqual(two.map((e) => e.key), ['system.board({})', 'uci.get({"config":"network"})']);
});

test('rewriteBase: only a quoted /cgi-bin/ or /luci-static/ prefix gets BASE spliced in', () => {
	const html = `<a href="/cgi-bin/luci/admin/status/overview">x</a><link href='/luci-static/resources/luci.js'>`;
	const out = rewriteBase(html, '/luci-theme-footstrap/playground');
	assert.equal(out, `<a href="/luci-theme-footstrap/playground/cgi-bin/luci/admin/status/overview">x</a>`
		+ `<link href='/luci-theme-footstrap/playground/luci-static/resources/luci.js'>`);
});

test('rewriteBase leaves the escaped \\/cgi-bin\\/ form (the env block) untouched', () => {
	const html = `L = new LuCI({"scriptname":"\\/cgi-bin\\/luci"});`;
	assert.equal(rewriteBase(html, '/base'), html);
});

test('rewriteEnv rewrites scriptname/resource/media and points ubuspath at BASE/ubus/', () => {
	const env = {
		media: '/luci-static/bootstrap/footstrap-media.css',
		resource: '/luci-static/resources',
		scriptname: '/cgi-bin/luci',
		pathinfo: '',
		ubuspath: '/ubus/',
		sessionid: 'a'.repeat(32),
	};
	const escaped = JSON.stringify(env).replace(/\//g, '\\/');
	const html = `<script>L = new LuCI(${escaped});</script>`;
	const out = rewriteEnv(html, '/luci-theme-footstrap/playground');
	const m = out.match(/new LuCI\((\{.*?\})\);/s);
	const rewritten = JSON.parse(m[1].replace(/\\\//g, '/'));
	assert.equal(rewritten.scriptname, '/luci-theme-footstrap/playground/cgi-bin/luci');
	assert.equal(rewritten.resource, '/luci-theme-footstrap/playground/luci-static/resources');
	assert.equal(rewritten.media, '/luci-theme-footstrap/playground/luci-static/bootstrap/footstrap-media.css');
	assert.equal(rewritten.ubuspath, '/luci-theme-footstrap/playground/ubus/');
	/* untouched fields survive the round trip */
	assert.equal(rewritten.pathinfo, '');
});

test('scrubTokens replaces every 32-hex literal, wherever it sits', () => {
	const sid = 'deadbeef'.repeat(4);
	const html = `L=new LuCI({"sessionid":"${sid}","token":"${sid}"}); confirm(true,0,"${sid}");`;
	const out = scrubTokens(html);
	assert.ok(!out.includes(sid));
	assert.equal((out.match(new RegExp(TOKEN_STUB, 'g')) || []).length, 3);
});

test('scrubHost drops the stand host:port, leaves everything else', () => {
	assert.equal(scrubHost('http://localhost:8341/cgi-bin/luci and localhost:8341 again', 'localhost:8341'),
		'http://playground.invalid/cgi-bin/luci and playground.invalid again');
	assert.equal(scrubHost('unchanged', ''), 'unchanged');
});

test('rewriteLiteral swaps every occurrence, deletes on an empty `to`, no-ops on an empty `from` or an unset/unchanged `to`', () => {
	const html = '<div>keep this</div><p>No password set!</p><p>No password set!</p>';
	assert.equal(rewriteLiteral(html, '<p>No password set!</p>', ''), '<div>keep this</div>');
	assert.equal(rewriteLiteral(html, 'No password set!', 'root has a password'),
		'<div>keep this</div><p>root has a password</p><p>root has a password</p>');
	assert.equal(rewriteLiteral(html, '', 'x'), html);
	assert.equal(rewriteLiteral(html, 'No password set!', undefined), html);
	assert.equal(rewriteLiteral(html, 'No password set!', 'No password set!'), html);
});

test('rewriteHostnameInData swaps every occurrence recursively, no-ops on an empty or unchanged pair', () => {
	const rpc = {
		'system.board({})': { result: [ 0, { hostname: 'owrt2512', model: 'x' } ] },
		'uci.get({"config":"system"})': { result: [ 0, { values: { '@system[0]': { hostname: 'owrt2512' } } } ] },
		'network.getHostHints({})': { result: [ 0, { '00:11:22': { name: 'owrt2512' } } ] },
		list: [ 'owrt2512', 1 ],
	};
	const out = rewriteHostnameInData(rpc, 'owrt2512', 'footstrap-playground');
	assert.equal(out['system.board({})'].result[1].hostname, 'footstrap-playground');
	assert.equal(out['uci.get({"config":"system"})'].result[1].values['@system[0]'].hostname, 'footstrap-playground');
	assert.equal(out['network.getHostHints({})'].result[1]['00:11:22'].name, 'footstrap-playground');
	assert.deepEqual(out.list, [ 'footstrap-playground', 1 ]);
	/* the recording itself is never mutated */
	assert.equal(rpc['system.board({})'].result[1].hostname, 'owrt2512');
	assert.equal(rewriteHostnameInData(rpc, '', 'x'), rpc);
	assert.equal(rewriteHostnameInData(rpc, 'owrt2512', 'owrt2512'), rpc);
});

test('parseLsLines splits `ls -1` stdout into filenames, drops the trailing blank line and blank input', () => {
	assert.deepEqual(parseLsLines('wifi.svg\nwifi_disabled.svg\nsignal-000-000.svg\n'),
		[ 'wifi.svg', 'wifi_disabled.svg', 'signal-000-000.svg' ]);
	assert.deepEqual(parseLsLines(''), []);
	assert.deepEqual(parseLsLines('\n\n'), []);
});

test('stripBase removes BASE from a string anywhere it sits, recurses into arrays/objects, no-ops without one', () => {
	const base = '/luci-theme-footstrap/playground';
	assert.equal(stripBase(`/www${base}/luci-static/resources/preload`, base), '/www/luci-static/resources/preload');
	assert.deepEqual(stripBase({ path: `${base}/x`, list: [ `${base}/y`, 1 ] }, base), { path: '/x', list: [ '/y', 1 ] });
	assert.equal(stripBase('unchanged', ''), 'unchanged');
});

test('jsonForScript escapes every `<` so an inlined value cannot close the enclosing <script> early', () => {
	const out = jsonForScript({ evil: '</script><script>alert(1)</script><!--' });
	assert.ok(!out.includes('</script'));
	assert.ok(!out.includes('<!--'));
	assert.deepEqual(JSON.parse(out), { evil: '</script><script>alert(1)</script><!--' });
});

test('applyOverlay: a nested merge patches one key deep without dropping its siblings', () => {
	const rpc = {
		'luci-rpc.getWirelessDevices({})': { jsonrpc: '2.0', id: 1, result: [0, {
			radio0: { up: false, retry_setup_failed: true, config: { band: '2g' }, interfaces: [ 'x' ] },
		}] },
	};
	const out = applyOverlay(rpc, {
		'luci-rpc.getWirelessDevices({})': { merge: { radio0: { up: true, retry_setup_failed: false } } },
	});
	const radio0 = out['luci-rpc.getWirelessDevices({})'].result[1].radio0;
	assert.equal(radio0.up, true);
	assert.equal(radio0.retry_setup_failed, false);
	assert.deepEqual(radio0.config, { band: '2g' });
	assert.deepEqual(radio0.interfaces, [ 'x' ]);
});

test('pruneMenu keeps a leaf on a tree rooted at admin (action_menu\'s real shape), admin included', () => {
	const menu = { children: { admin: { children: {
		status: { title: 'Status', children: { overview: { title: 'Overview' } } },
		network: { title: 'Network', children: { network: { title: 'Interfaces' } } },
	} } } };
	const out = pruneMenu(menu, [ 'admin/status/overview' ]);
	assert.deepEqual(Object.keys(out.children), [ 'admin' ]);
	assert.deepEqual(Object.keys(out.children.admin.children), [ 'status' ]);
	assert.deepEqual(Object.keys(out.children.admin.children.status.children), [ 'overview' ]);
});

test('applyOverlay: replace swaps the payload, merge patches it, both keep the ubus envelope', () => {
	const rpc = {
		'system.board({})': { jsonrpc: '2.0', id: 1, result: [0, { hostname: 'stand-host', model: 'x86' }] },
		'network.device.status({"name":"eth0"})': { jsonrpc: '2.0', id: 2, result: [0, { up: false }] },
	};
	const out = applyOverlay(rpc, {
		'system.board({})': { merge: { hostname: 'footstrap' } },
		'network.device.status({"name":"eth0"})': { replace: { up: true, speed: '1000baseT/Full' } },
	});
	assert.deepEqual(out['system.board({})'].result, [0, { hostname: 'footstrap', model: 'x86' }]);
	assert.deepEqual(out['network.device.status({"name":"eth0"})'].result, [0, { up: true, speed: '1000baseT/Full' }]);
	/* the recording itself is never mutated */
	assert.deepEqual(rpc['system.board({})'].result, [0, { hostname: 'stand-host', model: 'x86' }]);
});

test('applyOverlay throws on a key the recording never saw', () => {
	assert.throws(() => applyOverlay({}, { 'system.board({})': { merge: {} } }),
		/no entry for "system\.board\(\{\}\)"/);
});

test('applyOverlay throws when an entry names neither replace nor merge', () => {
	assert.throws(() => applyOverlay({ 'system.board({})': { result: [0, {}] } }, { 'system.board({})': {} }),
		/needs "replace" or "merge"/);
});

test('pruneMenu keeps only recorded leaves and their ancestors', () => {
	const menu = {
		children: {
			status: { title: 'Status', children: {
				overview: { title: 'Overview' },
				processes: { title: 'Processes' },
			} },
			network: { title: 'Network', children: {
				network: { title: 'Interfaces' },
			} },
		},
	};
	const out = pruneMenu(menu, ['status/overview']);
	assert.deepEqual(Object.keys(out.children), ['status']);
	assert.deepEqual(Object.keys(out.children.status.children), ['overview']);
	assert.equal(out.children.status.title, 'Status');
	assert.equal(out.children.status.children.overview.title, 'Overview');
});

test('pruneMenu keeps two sibling leaves and drops everything else', () => {
	const menu = {
		children: {
			status: { children: { overview: { title: 'Overview' }, processes: { title: 'Processes' } } },
			network: { children: { network: { title: 'Interfaces' } } },
		},
	};
	const out = pruneMenu(menu, ['status/overview', 'status/processes']);
	assert.deepEqual(Object.keys(out.children), ['status']);
	assert.deepEqual(Object.keys(out.children.status.children).sort(), ['overview', 'processes']);
});

test('scrubDataDeep scrubs a token and the stand host buried in nested rpc data, keys included', () => {
	const sid = 'deadbeef'.repeat(4);
	const rpc = {
		'uci.get({"config":"system"})': {
			result: [ 0, { values: { '@system[0]': { hostname: 'x', note: `see http://localhost:8341/${sid}` } } } ],
		},
		[`session-${sid}`]: { result: [ 0, [ 'localhost:8341' ] ] },
	};
	const out = scrubDataDeep(rpc, 'localhost:8341');
	const flat = JSON.stringify(out);
	assert.ok(!flat.includes(sid), 'token survived scrubDataDeep');
	assert.ok(!flat.includes('localhost:8341'), 'stand host survived scrubDataDeep');
	assert.ok(flat.includes(TOKEN_STUB));
});

test('findSecrets flags a real token and the stand host, not the TOKEN_STUB placeholder', () => {
	const sid = 'deadbeef'.repeat(4);
	assert.deepEqual(findSecrets(`sid=${TOKEN_STUB}`, 'localhost:8341'), []);
	assert.deepEqual(findSecrets(`sid=${sid}`, ''), [ 'a session-token-shaped 32-hex literal' ]);
	assert.deepEqual(findSecrets('reachable at localhost:8341', 'localhost:8341'), [ 'the stand host "localhost:8341"' ]);
});

test('guardNoSecrets throws naming the file a planted token sits in, passes a clean set', () => {
	const sid = 'deadbeef'.repeat(4);
	assert.throws(() => guardNoSecrets([ [ 'cgi-bin/luci/admin/status/overview/index.html', `x=${sid}` ] ], ''),
		/cgi-bin\/luci\/admin\/status\/overview\/index\.html/);
	assert.doesNotThrow(() => guardNoSecrets([ [ 'a.html', `x=${TOKEN_STUB}` ] ], 'localhost:8341'));
});

test('isSafeReturn accepts only an admin page under base, rejects traversal, backslash, another host and a non-string', () => {
	const base = '/luci-theme-footstrap/playground';
	assert.equal(isSafeReturn(`${base}/cgi-bin/luci/admin/system/footstrap`, base), true);
	assert.equal(isSafeReturn(`${base}/cgi-bin/luci/`, base), false, 'the login page itself is not an admin page');
	assert.equal(isSafeReturn('/cgi-bin/luci/admin/system/footstrap', base), false, 'missing base prefix');
	assert.equal(isSafeReturn(`${base}/cgi-bin/luci/admin/../../../etc/passwd`, base), false);
	assert.equal(isSafeReturn(`${base}/cgi-bin/luci/admin/\\evil`, base), false);
	assert.equal(isSafeReturn(`${base}/cgi-bin/luci/admin//evil.example`, base), false);
	assert.equal(isSafeReturn(`https://evil.example${base}/cgi-bin/luci/admin/x`, base), false);
	assert.equal(isSafeReturn(null, base), false);
	assert.equal(isSafeReturn(undefined, base), false);
});

test('resolveUnderRoot keeps an ordinary request inside root, rejects a traversal and a NUL byte', () => {
	const root = '/out';
	assert.equal(resolveUnderRoot(root, '/cgi-bin/luci/admin/status/overview/index.html'),
		'/out/cgi-bin/luci/admin/status/overview/index.html');
	assert.equal(resolveUnderRoot(root, '/../../etc/passwd'), null);
	assert.equal(resolveUnderRoot(root, '/foo/../../etc/passwd'), null);
	assert.equal(resolveUnderRoot(root, '/foo\0bar'), null);
});

test('missingOverlayKeys: every overlay key not present in rpc, none when rpc has them all', () => {
	const overlay = { 'system.board({})': {}, 'system.info({})': {} };
	assert.deepEqual(missingOverlayKeys({}, overlay), [ 'system.board({})', 'system.info({})' ]);
	assert.deepEqual(missingOverlayKeys({ 'system.board({})': {} }, overlay), [ 'system.info({})' ]);
	assert.deepEqual(missingOverlayKeys({ 'system.board({})': {}, 'system.info({})': {} }, overlay), []);
	assert.deepEqual(missingOverlayKeys({}, {}), []);
});

test('createActivityTracker: quiet only once the set is empty AND quietMs has passed since the last start/finish', () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	assert.equal(tracker.quiet(0), true, 'nothing ever started, 0ms is always long enough');
	tracker.start('a');
	assert.equal(tracker.pendingCount(), 1);
	assert.equal(tracker.quiet(0), false, 'still pending');
	t = 50;
	tracker.finish('a');
	assert.equal(tracker.pendingCount(), 0);
	assert.equal(tracker.quiet(100), false, 'idle, but not for 100ms yet');
	t = 150;
	assert.equal(tracker.quiet(100), true);
});

test('createActivityTracker: a slow finish re-opens the clock at FINISH, not at its own start', () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	tracker.start('slow-ubus-post');
	t = 800; /* a reply slower than a 750ms quiet window would allow if clocked at issue time */
	tracker.finish('slow-ubus-post');
	assert.equal(tracker.quiet(750), false, 'the clock just reset at finish(), 0ms elapsed since');
	t = 800 + 750;
	assert.equal(tracker.quiet(750), true);
});

test('createActivityTracker: a second start after the first finishes keeps the window open until IT finishes too', () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	tracker.start('a'); t = 10; tracker.finish('a');
	t = 20; tracker.start('b'); /* a lazy include firing after the first request already settled */
	assert.equal(tracker.quiet(5), false);
	t = 30; tracker.finish('b');
	assert.equal(tracker.quiet(5), false, 'only 0ms idle since b finished');
	t = 36;
	assert.equal(tracker.quiet(5), true);
});

test('createActivityTracker: a stale request from an earlier generation never blocks quiet() for the current one', () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	tracker.start('gen0-abandoned', 0); /* Playwright drops requestfinished/requestfailed for a
		request its own page abandoned on navigation — this one never calls finish() */
	t = 10;
	tracker.start('gen1-doc', 1);
	t = 20;
	tracker.finish('gen1-doc');
	assert.equal(tracker.quiet(50, 1), false, 'not idle for 50ms yet');
	t = 70;
	assert.equal(tracker.quiet(50, 1), true, 'gen1 is quiet even though the gen0 request never finished');
	assert.equal(tracker.pendingCount(0), 1, 'the abandoned gen0 request is still tracked until pruned');
});

test('createActivityTracker: prune(gen) drops every entry not tagged that generation', () => {
	const tracker = createActivityTracker(() => 0);
	tracker.start('gen0-a', 0);
	tracker.start('gen0-b', 0);
	tracker.start('gen1-c', 1);
	tracker.prune(1);
	assert.equal(tracker.pendingCount(0), 0);
	assert.equal(tracker.pendingCount(1), 1);
	assert.deepEqual(tracker.pendingEntries(1), [ 'gen1-c' ]);
});

test('describePendingRequest: method + path, no suffix for a plain GET', () => {
	assert.equal(
		describePendingRequest('GET', 'http://192.168.1.1/luci-static/resources/luci.js', null),
		'GET /luci-static/resources/luci.js',
	);
});

test('describePendingRequest: appends the ubus object.method a POST body calls', () => {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [ 'sid', 'system', 'board', {} ] });
	assert.equal(describePendingRequest('POST', 'http://192.168.1.1/ubus/', body), 'POST /ubus/ [system.board]');
});

test('describePendingRequest: a batched POST names every call in the batch', () => {
	const body = JSON.stringify([
		{ jsonrpc: '2.0', id: 1, method: 'call', params: [ 'sid', 'system', 'board', {} ] },
		{ jsonrpc: '2.0', id: 2, method: 'call', params: [ 'sid', 'uci', 'get', { config: 'system' } ] },
	]);
	assert.equal(describePendingRequest('POST', 'http://192.168.1.1/ubus/', body), 'POST /ubus/ [system.board, uci.get]');
});

test('describePendingRequest: a POST body that is not a ubus call gets no suffix', () => {
	assert.equal(describePendingRequest('POST', 'http://192.168.1.1/cgi-bin/luci/', 'not json'), 'POST /cgi-bin/luci/');
	assert.equal(
		describePendingRequest('POST', 'http://192.168.1.1/cgi-bin/luci/', JSON.stringify({ method: 'list' })),
		'POST /cgi-bin/luci/',
	);
});

test('describePendingRequests: joins up to the limit and counts the rest', () => {
	const reqs = Array.from({ length: 12 }, (_, i) => ({ method: 'GET', url: `http://h/luci-static/${i}.js`, postData: null }));
	const out = describePendingRequests(reqs, 10);
	assert.equal(out, `${Array.from({ length: 10 }, (_, i) => `GET /luci-static/${i}.js`).join(', ')}, +2 more`);
});

test('waitForQuiet: the timeout message names the still-pending requests (method + path, ubus call)', async () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	const stuck = {
		method: 'POST', url: 'http://192.168.1.1/ubus/',
		postData: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [ 'sid', 'system', 'board', {} ] }),
	};
	tracker.start(stuck, 1); /* current generation is 1: a page-2 request never settling must not be
		blamed on page 1's own, already-pruned, generation-0 entries */
	const sleep = async (ms) => { t += ms; };
	await assert.rejects(
		() => waitForQuiet({
			isQuiet: () => tracker.quiet(50, 1),
			quietMs: 50, timeoutMs: 100, now, sleep, pollMs: 50,
			describe: () => {
				const pending = tracker.pendingEntries(1);
				return `${pending.length} request(s) still in flight: ${describePendingRequests(pending)}`;
			},
		}),
		/1 request\(s\) still in flight: POST \/ubus\/ \[system\.board\]/,
	);
});

test('createGenerationGate: a response tagged before the latest bump() reads as stale, one tagged after as current', () => {
	const gate = createGenerationGate();
	gate.tag('login-landing-req'); /* generation 0, before any bump — e.g. login()'s own navigation */
	assert.equal(gate.isCurrent('login-landing-req'), true, 'still generation 0, nothing has bumped yet');
	gate.bump(); /* the capture loop's first page */
	assert.equal(gate.isCurrent('login-landing-req'), false, 'a later generation is now current');
	gate.tag('page1-req');
	assert.equal(gate.isCurrent('page1-req'), true);
	gate.bump(); /* the second page */
	assert.equal(gate.isCurrent('page1-req'), false);
	assert.equal(gate.isCurrent('page1-req'), false, 'reading it again does not change the answer');
});

test('createGenerationGate: an id that was never tagged is never current', () => {
	const gate = createGenerationGate();
	assert.equal(gate.isCurrent('never-tagged'), false);
	gate.bump();
	assert.equal(gate.isCurrent('never-tagged'), false);
});

test('waitForQuiet resolves once isQuiet() starts returning true', async () => {
	let t = 0;
	let quiet = false;
	const now = () => t;
	const sleep = async (ms) => { t += ms; if (t >= 200) quiet = true; };
	const idleFor = await waitForQuiet({
		isQuiet: () => quiet, quietMs: 200, timeoutMs: 5000, now, sleep, pollMs: 50,
	});
	assert.ok(idleFor >= 150, `expected idleFor >= 150, got ${idleFor}`);
});

test('waitForQuiet throws naming the deadline when isQuiet() never turns true', async () => {
	let t = 0;
	const now = () => t;
	const sleep = async (ms) => { t += ms; };
	await assert.rejects(
		() => waitForQuiet({ isQuiet: () => false, quietMs: 200, timeoutMs: 1000, now, sleep, pollMs: 100 }),
		/no 200ms quiet window reached within 1000ms$/,
	);
});

test('waitForQuiet appends describe() to the timeout error when given', async () => {
	let t = 0;
	const now = () => t;
	const sleep = async (ms) => { t += ms; };
	await assert.rejects(
		() => waitForQuiet({
			isQuiet: () => false, quietMs: 200, timeoutMs: 1000, now, sleep, pollMs: 100,
			describe: () => '2 request(s) still in flight',
		}),
		/no 200ms quiet window reached within 1000ms \(2 request\(s\) still in flight\)/,
	);
});

test('waitForQuiet + createActivityTracker together: quiet only once every in-flight request has finished and settled for quietMs', async () => {
	let t = 0;
	const now = () => t;
	const tracker = createActivityTracker(now);
	tracker.start('doc');
	const sleep = async (ms) => {
		t += ms;
		if (t === 50) { tracker.finish('doc'); tracker.start('lazy-include'); } /* a late-firing request */
		if (t === 100) tracker.finish('lazy-include');
	};
	const idleFor = await waitForQuiet({
		isQuiet: () => tracker.quiet(50), quietMs: 50, timeoutMs: 5000, now, sleep, pollMs: 25,
	});
	assert.ok(idleFor >= 100, `expected idleFor >= 100 (idle only starts once "lazy-include" finishes at t=100), got ${idleFor}`);
});

test('drainReads: every read succeeded — settled carries both, nothing abandoned', async () => {
	const result = await drainReads([
		[ 'a', Promise.resolve('ok') ],
		[ 'b', Promise.resolve('ok') ],
	]);
	assert.deepEqual(result.abandoned, []);
	assert.deepEqual(result.settled.map((s) => [ s.label, s.status ]), [ [ 'a', 'fulfilled' ], [ 'b', 'fulfilled' ] ]);
});

test('drainReads: never throws — a rejected read comes back in settled, not as an exception', async () => {
	const result = await drainReads([
		[ 'good', Promise.resolve('ok') ],
		[ 'ubus POST /ubus/', Promise.reject(new Error('closed')) ],
		[ 'GET /luci-static/x.js', Promise.reject(new Error('navigated')) ],
	]);
	assert.deepEqual(result.abandoned, []);
	const byLabel = Object.fromEntries(result.settled.map((s) => [ s.label, s ]));
	assert.equal(byLabel.good.status, 'fulfilled');
	assert.equal(byLabel['ubus POST /ubus/'].status, 'rejected');
	assert.equal(byLabel['ubus POST /ubus/'].reason.message, 'closed');
	assert.equal(byLabel['GET /luci-static/x.js'].status, 'rejected');
	assert.equal(byLabel['GET /luci-static/x.js'].reason.message, 'navigated');
});

test('drainReads: a read that never settles is named in `abandoned`, never thrown', async () => {
	let releaseHung;
	const hung = new Promise((resolve) => { releaseHung = resolve; });
	const result = await drainReads([
		[ 'GET /luci-static/x.js', Promise.resolve('ok') ],
		[ 'ubus POST /ubus/', hung ],
	], 30);
	assert.deepEqual(result.abandoned, [ 'ubus POST /ubus/' ]);
	assert.deepEqual(result.settled.map((s) => s.label), [ 'GET /luci-static/x.js' ]);
	releaseHung('ok'); /* let the dangling promise settle so it cannot leak into a later test */
});
