/* A page that leaves its own nodes as direct children of <body> and never removes them (issue #56,
 * luci-app-bandix's render()) must hand the next SPA navigation over to a full load, the same way an
 * invasive foreign <style> already does (docs/third-party-apps.md, Rule 2 extended to the DOM).
 *
 * The recorder itself — the inline <script> at the top of header.ut's <body> — is browser-only and
 * cannot be driven through tests/lib/luci-module.mjs's stubs (see tools/smoke.mjs for the real-DOM
 * check on it). What this file drives is the half that lives in fs-router.js: strayBodyNode()'s
 * judgement of one recorded element, and bodyLittered()'s reading of window.__fsBodyAdds as a whole,
 * fed a hand-built recording that stands in for what the recorder would have produced. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeL, fakeWindow, fakeDocument } from './lib/luci-module.mjs';

/* A DOM element carries no class this harness can construct with jsdom-style APIs — luci-module.mjs
 * is deliberately not a browser (see its own header) — so this is the same kind of hand-built stand-in
 * the fake window/document already are: just enough surface for strayBodyNode()/bodyLittered() to read. */
/* `data-*` -> `dataset.camelCase`, the same conversion a real element's `dataset` getter performs —
 * strayBodyNode() reads the chrome mark through `dataset`, not `hasAttribute`, precisely so that
 * `tools/chrome-fence.mjs`'s literal-string count of `'data-fs-chrome'` sees fs-search.js's real
 * mount and nothing else (fs-router.js, the comment above the read). */
function toCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function fakeElement({ nodeName = 'DIV', id = '', classes = [], attrs = {}, display = '', parent = null } = {}) {
	const cls = new Set(classes);
	const dataset = {};
	for (const k of Object.keys(attrs))
		if (k.indexOf('data-') === 0) dataset[toCamel(k.slice(5))] = String(attrs[k]);
	return {
		nodeType: 1,
		nodeName: nodeName.toUpperCase(),
		id,
		style: { display },
		parentNode: parent,
		dataset,
		hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
		classList: {
			contains: (c) => cls.has(c),
			[Symbol.iterator]: () => cls.values()
		}
	};
}

/* A router whose early-return checks (documentPoisoned, bodyLittered) are all a caller needs to
 * reach: fs-menutree only has to answer segsFromPath with something truthy, and fs-sheets only has to
 * answer documentPoisoned — resolveSegs/viewClassFor are never reached once either check returns. */
function router({ window, document } = {}) {
	const win = window || fakeWindow();
	const doc = document || fakeDocument();
	const L = fakeL();
	win.L = L;
	return loadModule('fs-router', {
		L, window: win, document: doc,
		stubs: {
			ui: { hideModal() {} },
			rpc: { addInterceptor() {} },
			'fs-menutree': { segsFromPath: () => [ 'admin', 'status', 'overview' ],
				currentNode: () => null, resolveSegs: () => null, viewClassFor: () => null },
			'fs-sheets': { documentPoisoned: () => false }
		}
	});
}

test('bandix\'s own unmarked tooltip/modal nodes are stray', () => {
	const mod = router();
	const body = {};
	const el = fakeElement({ id: 'schedule-rules-tooltip', parent: body });
	assert.equal(mod.strayBodyNode(el), true);
});

test('a node with no class or id at all is stray too', () => {
	const mod = router();
	const el = fakeElement({ classes: [] });
	assert.equal(mod.strayBodyNode(el), true);
});

test('the theme\'s own chrome mark is not stray', () => {
	const mod = router();
	const el = fakeElement({ attrs: { 'data-fs-chrome': '' } });
	assert.equal(mod.strayBodyNode(el), false);
});

test('an fs-* id or class is not stray, marked or not', () => {
	const mod = router();
	assert.equal(mod.strayBodyNode(fakeElement({ id: 'fs-nav-progress' })), false, 'fs-router\'s own progress bar');
	assert.equal(mod.strayBodyNode(fakeElement({ id: 'fs-chrome-geom-probe' })), false, 'fs-chrome\'s geometry probe');
	assert.equal(mod.strayBodyNode(fakeElement({ id: 'fs-appearance-probe' })), false, 'fs-appearance\'s colour probe');
	assert.equal(mod.strayBodyNode(fakeElement({ classes: [ 'fs-search-ov' ] })), false, 'an fs-* class alone');
});

test('script/style/link/template/noscript/meta never count, whatever else they carry', () => {
	const mod = router();
	for (const nodeName of [ 'SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'META' ])
		assert.equal(mod.strayBodyNode(fakeElement({ nodeName })), false, nodeName);
});

test('stock LuCI\'s #modal_overlay and .cbi-tooltip (ui.js __init__) are not stray', () => {
	const mod = router();
	assert.equal(mod.strayBodyNode(fakeElement({ id: 'modal_overlay' })), false);
	assert.equal(mod.strayBodyNode(fakeElement({ classes: [ 'cbi-tooltip' ] })), false);
});

test('ui.js\'s hidden download anchor is not stray; a download link left visible is', () => {
	const mod = router();
	const hidden = fakeElement({ nodeName: 'A', attrs: { download: '' }, display: 'none' });
	assert.equal(mod.strayBodyNode(hidden), false, 'handleDownload() leaves exactly this shape in place');
	const visible = fakeElement({ nodeName: 'A', attrs: { download: '' }, display: '' });
	assert.equal(mod.strayBodyNode(visible), true, 'no app is entitled to this shape, only the hidden one');
	const noDownload = fakeElement({ nodeName: 'A', display: 'none' });
	assert.equal(mod.strayBodyNode(noDownload), true, 'display:none alone is not the signal, download is part of it');
});

test('bodyLittered() is false with no recording at all', () => {
	const win = fakeWindow();
	const mod = router({ window: win });
	assert.equal(mod.bodyLittered(), false);
});

test('bodyLittered() prunes a recorded node that is no longer a direct child of <body>, and does not count it', () => {
	const win = fakeWindow();
	const doc = fakeDocument({ body: {} });
	const mod = router({ window: win, document: doc });
	const view = {};	/* stands in for #view: the node was moved inside it, or simply removed */
	const moved = fakeElement({ id: 'whitelist-modal', parent: view });
	win.__fsBodyAdds = [ moved ];
	assert.equal(mod.bodyLittered(), false, 'a node no longer parented to <body> is not litter');
	assert.equal(win.__fsBodyAdds.length, 0, 'and it is dropped from the recording, or it would be re-judged forever');
});

test('a stray node still parented to <body> makes the document littered', () => {
	const win = fakeWindow();
	const doc = fakeDocument({ body: {} });
	const mod = router({ window: win, document: doc });
	win.__fsBodyAdds = [ fakeElement({ id: 'lan-traffic-tooltip', parent: doc.body }) ];
	assert.equal(mod.bodyLittered(), true);
});

test('a recorded node that is ours (fs-* id) does not litter the document', () => {
	const win = fakeWindow();
	const doc = fakeDocument({ body: {} });
	const mod = router({ window: win, document: doc });
	win.__fsBodyAdds = [ fakeElement({ id: 'fs-nav-progress', parent: doc.body }) ];
	assert.equal(mod.bodyLittered(), false);
});

test('navigate() declines the SPA nav (returns false) when the document is littered', () => {
	const win = fakeWindow();
	const doc = fakeDocument({ body: {} });
	const mod = router({ window: win, document: doc });
	win.__fsBodyAdds = [ fakeElement({ id: 'bandix-modal-overlay-0', parent: doc.body }) ];
	assert.equal(mod.navigate('/cgi-bin/luci/admin/status/overview', true), false);
});

test('navigate() does not even reach bodyLittered() when the document is already poisoned', () => {
	/* documentPoisoned() is asked first (fs-router.js), so a poisoned document must not depend on
	 * bodyLittered() to be declined — this only proves the ORDER, not a second reason to decline */
	const win = fakeWindow();
	const doc = fakeDocument({ body: {} });
	const L = fakeL();
	win.L = L;
	const mod = loadModule('fs-router', {
		L, window: win, document: doc,
		stubs: {
			ui: { hideModal() {} },
			rpc: { addInterceptor() {} },
			'fs-menutree': { segsFromPath: () => [ 'admin', 'status', 'overview' ],
				currentNode: () => null, resolveSegs: () => null, viewClassFor: () => null },
			'fs-sheets': { documentPoisoned: () => true }
		}
	});
	assert.equal(mod.navigate('/cgi-bin/luci/admin/status/overview', true), false);
});
