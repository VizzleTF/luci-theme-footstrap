/* THE LIVE HALF OF THE GATES: one place that knows how to reach a running router, log into LuCI and
 * enumerate its pages.
 *
 * Every static gate in this repo measures a FILE. The bugs that reached users measured a PAGE:
 * a column shredded to one character per line (#11), a submenu title clipped (#22), a doubled
 * scrollbar in Firefox (#12), a third-party app's tabs laid out wrong (#36, #33, #8), a client
 * navigation that painted less than a full load (upstream review). None of those can be seen in a
 * stylesheet; all of them are one query away on a live page. This module is what the live gates
 * share so they cannot drift apart on how a router is found or how a menu is walked.
 *
 * The routers are owlab's — `owlab status -json` names each one and the port it answers on, so
 * nothing here hard-codes a port or a container name. Nothing here boots anything either: a gate
 * that starts and stops containers by itself is a gate nobody runs locally.
 */
import { execFileSync } from 'node:child_process';

/* Every RUNNING owlab router, newest release first, or an empty array when owlab is absent — the
 * caller decides whether that is a failure (a gate) or a reason to skip (a local convenience). */
export function stands(only) {
	let out;
	try {
		out = execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] });
	} catch (e) {
		return [];
	}
	let parsed;
	try { parsed = JSON.parse(out); } catch (e) { return []; }
	const wanted = (only || '').split(',').map((s) => s.trim()).filter(Boolean);
	return (parsed.routers || [])
		.filter((r) => r.state === 'running' && r.http_port)
		.filter((r) => !wanted.length || wanted.includes(r.id))
		.map((r) => ({
			id: r.id,
			base: `http://localhost:${r.http_port}/cgi-bin/luci`,
			release: r.release,
			distro: r.distro,
			pkg: r.package_manager,
		}));
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

/* Every LEAF of the router's own menu tree, as LuCI itself resolves it — not a list of paths we
 * keep in the repo, which would go stale the moment an app is installed or a release moves a page.
 *
 * `L.ui.menu.load()` returns the tree ALREADY rooted at `admin`, so the walk starts with an empty
 * path: seeding it with the root's name produced `/admin/admin/...` and a sweep of 404s that looked
 * like a clean run. */
export async function menuPaths(page) {
	/* `L.ui` is only there once ui.js has been required by something on the page, and how soon that
	 * happens differs between release lines — reading it straight after the login redirect crashed
	 * the 24.10 leg with "Cannot read properties of undefined (reading 'menu')" while 25.12 was fine.
	 * Wait for the runtime, then ask for the module by name rather than hoping somebody else did. */
	await page.waitForFunction(() => window.L && typeof window.L.require === 'function', null, { timeout: 20000 });
	return page.evaluate(async () => {
		const ui = await L.require('ui');
		const tree = await ui.menu.load();
		const out = [];
		const walk = (node, path) => {
			for (const name of Object.keys(node.children || {})) {
				const child = node.children[name];
				const p = path.concat(name);
				if (child.children && Object.keys(child.children).length) walk(child, p);
				else out.push('/' + p.join('/'));
			}
		};
		walk(tree, []);
		return out;
	});
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
