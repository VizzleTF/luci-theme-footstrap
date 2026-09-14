/* tools/playground/lib.mjs — the pure half of the record-and-replay pipeline. capture.mjs and
 * verify.mjs both need a live owlab stand (T2); this is what proves the deterministic half without
 * one: the recording key a request and a reply agree on, the rewrites build.mjs applies to a
 * captured document, and the overlay/menu edits it makes on top of the recorded JSON. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	stableStringify, ubusKey, requestKey, splitBatch,
	rewriteBase, rewriteEnv, scrubTokens, scrubHost, rewriteHostname, rewriteHostnameInData,
	rewriteLiteral, stripBase, jsonForScript, applyOverlay, pruneMenu, parseLsLines, TOKEN_STUB,
	scrubDataDeep, findSecrets, guardNoSecrets, resolveUnderRoot, isSafeReturn,
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

test('rewriteHostname swaps every literal occurrence, no-ops on an empty or unchanged pair', () => {
	const html = `<title>owrt2512 | Overview</title><h1>owrt2512</h1>`;
	assert.equal(rewriteHostname(html, 'owrt2512', 'footstrap-playground'),
		`<title>footstrap-playground | Overview</title><h1>footstrap-playground</h1>`);
	assert.equal(rewriteHostname(html, '', 'x'), html);
	assert.equal(rewriteHostname(html, 'owrt2512', 'owrt2512'), html);
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
