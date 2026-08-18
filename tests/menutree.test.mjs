/* fs-menutree is a PORT of dispatcher.uc's resolution, and a port is only worth what it agrees with.
 *
 * The stakes are stated in the module itself: resolve a `firstchild` differently from the server and
 * a click opens one page while F5 opens another, on the same URL. The stands prove the agreement for
 * the trees THEY carry; these cases pin the rules the trees happen not to exercise — a tie broken by
 * key order, a login node sorted last, a firstchild whose only children are themselves unresolvable,
 * an alias loop planted by a foreign menu.d — none of which any shipped menu contains, and all of
 * which the next installed app is free to introduce.
 *
 * `readonlyForSegs` gets the same treatment for the opposite reason: the AND-down-the-path rule was
 * measured wrong once in each direction (module comment), and both directions are cheap to pin here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeL } from './lib/luci-module.mjs';

const view = (path, extra = {}) => ({ title: path, satisfied: true, action: { type: 'view', path }, ...extra });

function menu(children) {
	return { title: 'root', satisfied: true, children };
}

function tree(children, env = {}) {
	const L = fakeL();
	Object.assign(L.env, env);
	const m = loadModule('fs-menutree', { L });
	m.setTree(menu(children));
	return m;
}

test('a plain view resolves to itself and to its class name', () => {
	const m = tree({ admin: { title: 'a', satisfied: true, action: { type: 'firstchild' },
		children: { status: view('status/index') } } });
	const r = m.resolveSegs([ 'admin', 'status' ]);
	assert.deepEqual(r.segs, [ 'admin', 'status' ]);
	assert.equal(m.viewClassFor(r.node), 'view.status.index');
});

test('an alias is followed from the ROOT, not from where it sits', () => {
	const m = tree({
		admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
			logs: { title: 'logs', satisfied: true, action: { type: 'alias', path: 'admin/status/syslog' } },
			status: { title: 'status', satisfied: true, action: { type: 'firstchild' }, children: {
				syslog: view('status/syslog')
			} }
		} }
	});
	const r = m.resolveSegs([ 'admin', 'logs' ]);
	assert.deepEqual(r.segs, [ 'admin', 'status', 'syslog' ]);
	assert.equal(m.viewClassFor(r.node), 'view.status.syslog');
});

test('firstchild takes the lowest order, and a tie keeps tree order', () => {
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		second: view('b', { order: 10 }),
		first: view('a', { order: 1 }),
		tie_a: view('t1', { order: 1 })
	} } });
	assert.deepEqual(m.resolveSegs([ 'admin' ]).segs, [ 'admin', 'first' ],
		'order 1 must beat order 10');

	const ties = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		alpha: view('a', { order: 5 }),
		beta: view('b', { order: 5 })
	} } });
	assert.deepEqual(ties.resolveSegs([ 'admin' ]).segs, [ 'admin', 'alpha' ],
		'a tie goes to the first key, the way a strict > comparison over an ordered object does');
});

test('a login node sorts last even with the lowest order', () => {
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		login: view('login', { order: 1, auth: { login: true } }),
		overview: view('status/overview', { order: 900 })
	} } });
	assert.deepEqual(m.resolveSegs([ 'admin' ]).segs, [ 'admin', 'overview' ]);
});

test('an unsatisfied, titleless or ineligible child is not a candidate', () => {
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		hidden: view('a', { order: 1, satisfied: false }),
		untitled: { satisfied: true, order: 2, action: { type: 'view', path: 'b' } },
		skipped: view('c', { order: 3, firstchild_ineligible: true }),
		real: view('d', { order: 4 })
	} } });
	assert.deepEqual(m.resolveSegs([ 'admin' ]).segs, [ 'admin', 'real' ]);
});

test('a firstchild whose children resolve to nothing is itself not a candidate', () => {
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		empty: { title: 'empty', satisfied: true, order: 1, action: { type: 'firstchild' }, children: {} },
		real: view('d', { order: 2 })
	} } });
	assert.deepEqual(m.resolveSegs([ 'admin' ]).segs, [ 'admin', 'real' ]);
});

test('an alias loop from a foreign menu.d ends in null, not in a hang', () => {
	const m = tree({ a: { title: 'a', satisfied: true, action: { type: 'alias', path: 'b' } },
		b: { title: 'b', satisfied: true, action: { type: 'alias', path: 'a' } } });
	assert.equal(m.resolveSegs([ 'a' ]), null);
});

test('a path outside the menu resolves to null, and one outside scriptname yields no segments', () => {
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' },
		children: { status: view('status/index') } } });
	assert.equal(m.resolveSegs([ 'admin', 'nope' ]), null);
	assert.equal(m.segsFromPath('/some/other/app'), null);
	assert.deepEqual(m.segsFromPath('/cgi-bin/luci/'), [],
		'the bare base is the root node, which is itself a firstchild — not an unroutable path');
	assert.deepEqual(m.segsFromPath('/cgi-bin/luci/admin/status'), [ 'admin', 'status' ]);
});

test('only view nodes and the Overview template carry a class', () => {
	const m = tree({});
	assert.equal(m.viewClassFor({ satisfied: true, action: { type: 'cbi', path: 'x' } }), null);
	assert.equal(m.viewClassFor({ satisfied: true, action: { type: 'template', path: 'foo/bar' } }), null);
	assert.equal(m.viewClassFor({ satisfied: true, action: { type: 'template', path: 'admin_status/index' } }),
		'view.status.index');
	assert.equal(m.viewClassFor({ satisfied: false, action: { type: 'view', path: 'a' } }), null,
		'an unsatisfied node is the server\'s to refuse, never ours to open');
});

test('readonly is AND down the path: one writable acl re-opens it', () => {
	const acl = (names, readonly) => ({ title: 'n', satisfied: true, readonly,
		depends: { acl: names }, action: { type: 'firstchild' } });
	const m = tree({ admin: { title: 'admin', satisfied: true, action: { type: 'firstchild' }, children: {
		locked: { ...acl([ 'luci-mod-status-logs' ], true), children: {
			all: { ...acl([ 'luci-mod-status-logs' ], true), action: { type: 'view', path: 'a' } },
			mine: { ...acl([ 'luci-app-mine' ], false), action: { type: 'view', path: 'b' } },
			ungated: view('c')
		} }
	} } });
	assert.equal(m.readonlyForSegs([ 'admin', 'locked', 'all' ]), true);
	assert.equal(m.readonlyForSegs([ 'admin', 'locked', 'mine' ]), false,
		'a leaf with a writable acl of its own re-opens the whole path');
	assert.equal(m.readonlyForSegs([ 'admin', 'locked', 'ungated' ]), true,
		'a node carrying no acl is not evidence either way and must not clear the ancestor');
	assert.equal(m.readonlyForSegs([ 'admin' ]), false,
		'nothing on the path is acl-gated, so the dispatcher grants write');
});
