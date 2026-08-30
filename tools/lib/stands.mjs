/* The live half of the gates: one place that knows how to reach a running router, log into LuCI and
 * enumerate its pages.
 *
 * Every static gate here measures a FILE. The bugs that reached users measured a PAGE — a column
 * shredded to one character per line (#11), a submenu title clipped (#22), a doubled scrollbar in
 * Firefox (#12), a third-party app's tabs laid out wrong (#36, #33, #8), a client navigation that
 * painted less than a full load (upstream review). None can be seen in a stylesheet; all are one
 * query away on a live page.
 *
 * The routers are owlab's — `owlab status -json` names each one and the port it answers on, so
 * nothing here hard-codes a port or a container name. Nothing here boots anything either: a gate
 * that starts and stops containers by itself is a gate nobody runs locally. */
import { execFileSync } from 'node:child_process';

/* The routers a gate runs on by default: the three OpenWrt lines the theme actually supports.
 *
 * owlab can boot five — two distributions across two releases, plus a snapshot box. What can change
 * what this theme is measured against is the PACKAGE MANAGER (apk on 25.12+, opkg on 24.10) and the
 * luci-base the router carries; the snapshot box is the third because it tracks luci-base's master,
 * so an upstream change that will land in the next release fails here first rather than in a user's
 * report. That is the set every gate must cover.
 *
 * ImmortalWrt is NOT in the default set. It is the same luci-base with a different brand and app
 * set, it has never been the leg that caught something first, and it doubles a wall clock that is
 * already the reason people skip running the gates. It is measured when asked for — `--all`, or
 * `--only imm2512,…` — and a red immortalwrt leg is worth reading, not worth blocking a release on.
 *
 * A gate that takes `--only` must also honour `--all`: upstream-contract read the first and ignored
 * the second, so it silently measured a subset of what the release runbook had asked for. */
export const CORE = [ 'owrt2512', 'owrt2410', 'owrtsnap' ];

/* The set `--all` adds on top of CORE, kept apart so a caller can say "and the optional ones" and a
 * report can say which half a finding came from. */
export const OPTIONAL = [ 'imm2512', 'imm2410' ];

/* Every RUNNING owlab router, newest release first, or an empty array when owlab is absent — the
 * caller decides whether that is a failure (a gate) or a reason to skip (a local convenience).
 * With no `only` and no `all`, the CORE pair above; if none of it is running, everything that is,
 * with a line saying so — a gate that silently measured a different set than it claims is worse
 * than a slow one. */
export function stands(only, { all = false } = {}) {
	let out;
	try {
		out = execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] });
	} catch (e) {
		return [];
	}
	let parsed;
	try { parsed = JSON.parse(out); } catch (e) { return []; }
	const wanted = (only || '').split(',').map((s) => s.trim()).filter(Boolean);
	const running = (parsed.routers || [])
		.filter((r) => r.state === 'running' && r.http_port)
		.map((r) => ({
			id: r.id,
			base: `http://localhost:${r.http_port}/cgi-bin/luci`,
			release: r.release,
			distro: r.distro,
			pkg: r.package_manager,
		}));
	if (wanted.length) return running.filter((r) => wanted.includes(r.id));
	if (all) return running;
	const core = running.filter((r) => CORE.includes(r.id));
	if (core.length) return core;
	if (running.length)
		process.stderr.write(`(none of ${CORE.join(', ')} is running — measuring `
			+ `${running.map((r) => r.id).join(', ')} instead)\n`);
	return running;
}

/* LuCI answers an unauthenticated request with the login form, not a 403 page — so every live gate
 * has to log in before it can measure anything. owlab's routers are root with an empty password
 * (`owlab status` prints it); a hardware router is not what these gates run against. */
export async function login(page, base) {
	await page.goto(base, { waitUntil: 'domcontentloaded' });
	if (await page.$('input[name="luci_password"]')) {
		await page.fill('input[name="luci_username"]', 'root');
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
			page.press('input[name="luci_password"]', 'Enter'),
		]);
	}
}

/* Every LEAF of the router's own menu tree, as LuCI itself resolves it — not a list of paths kept
 * in the repo, which would go stale the moment an app is installed or a release moves a page.
 *
 * `L.ui.menu.load()` returns the tree ALREADY rooted at `admin`, so the walk starts with an empty
 * path: seeding it with the root's name produces `/admin/admin/...` and a sweep of 404s that looks
 * like a clean run. */
export async function menuPaths(page, opts = {}) {
	/* `L.ui` is only there once ui.js has been required by something on the page, and how soon that
	 * happens differs between release lines — reading it straight after the login redirect crashed
	 * the 24.10 leg with "Cannot read properties of undefined (reading 'menu')" while 25.12 was fine.
	 * Wait for the runtime, then ask for the module by name rather than hoping somebody else did. */
	await page.waitForFunction(() => window.L && typeof window.L.require === 'function', null, { timeout: 20000 });
	/* Only the leaves that are PAGES. A dispatcher tree carries far more than the menu shows: on a
	 * router with openclash and justclash installed, 105 of its 169 leaves are `call` nodes — RPC
	 * endpoints an app registers for its own JS — plus `function` nodes and the untitled plumbing.
	 * None renders a page, so a gate that measured layout on one measured an empty `#view` and spent
	 * two thirds of its wall clock proving that.
	 *
	 * `view` and `template` are the two that paint (plus `cbi` on an old enough app), and a node the
	 * menu does not title is not a page a user can reach. `{ all: true }` returns the raw walk, for a
	 * caller that wants the dispatcher rather than the interface. */
	return page.evaluate(async (all) => {
		const ui = await L.require('ui');
		const tree = await ui.menu.load();
		const RENDERS = { view: 1, template: 1, cbi: 1 };
		const out = [];
		const walk = (node, path) => {
			for (const name of Object.keys(node.children || {})) {
				const child = node.children[name];
				const p = path.concat(name);
				if (child.children && Object.keys(child.children).length) { walk(child, p); continue; }
				const type = (child.action && child.action.type) || '';
				if (all || (RENDERS[type] && child.title)) out.push('/' + p.join('/'));
			}
		};
		walk(tree, []);
		return out;
	}, !!opts.all);
}

/* Pages a sweep must not open twice: they end the session or the router, and the second visit
 * measures a login form or a dead container. Named by path fragment, because the menu labels are
 * translated and the paths are not. */
export const DESTRUCTIVE = /\/(logout|reboot|flash|backup|shutdown)(\/|$)/;

/* No stand, no verdict — and a gate that quietly reports success on zero routers is worse than one
 * that fails, because it looks the same as a clean run in a log. */
export function requireStands(list, name) {
	if (list.length) return list;
	console.error(`${name}: no owlab router is running, so nothing was checked.`);
	console.error('Start one with `owlab up` (see docs/development.md) and run this again.');
	process.exit(2);
}
