'use strict';
'require baseclass';
'require ui';

/* Shared menu logic for both footstrap layouts.
 *
 * LuCI instantiates every required baseclass module into a singleton, so a base
 * class can't be `extend`-ed across modules. The idiomatic workaround (as used
 * by luci-app-podkop: `require view.podkop.main as main; main.foo()`) is
 * COMPOSITION — export functions you call on the singleton, and inject the
 * variable part (the layout-specific renderMainMenu) as a callback.
 *
 * So: mode menu, section tabs and the theme toggle live here once; each layout
 * (menu-footstrap / menu-footstrap-top) only defines renderMainMenu and calls
 * common.bootstrap(renderMainMenu). */

/* section tabs -> #tabmenu (horizontal) */
function renderTabMenu(tree, url, level) {
	const container = document.querySelector('#tabmenu');
	const ul = E('ul', { 'class': 'tabs' });
	const children = ui.menu.getChildren(tree);
	let activeNode = null;

	children.forEach(child => {
		const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
		ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(child.name, isActive ? 'active' : '') }, [
			E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
		]));
		if (isActive)
			activeNode = child;
	});

	if (ul.children.length == 0)
		return E([]);

	container.appendChild(ul);
	container.style.display = '';

	if (activeNode)
		renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

	return ul;
}

/* modes -> #modemenu; drives the injected renderMainMenu for the active mode */
function renderModeMenu(tree, renderMainMenu) {
	const ul = document.querySelector('#modemenu');
	const children = ui.menu.getChildren(tree);

	children.forEach((child, index) => {
		const isActive = L.env.requestpath.length
			? child.name === L.env.requestpath[0]
			: index === 0;

		ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
			E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
		]));

		if (isActive)
			renderMainMenu(child, child.name);
	});

	if (children.length <= 1)
		ul.classList.add('single');
	if (ul.children.length > 1)
		ul.style.display = '';
}

/* header theme toggle (client-side data-darkmode + localStorage) */
function wireThemeToggle() {
	const btn = document.getElementById('fs-theme-toggle');
	if (!btn) return;
	btn.addEventListener('click', () => {
		const root = document.querySelector(':root');
		const dark = root.getAttribute('data-darkmode') !== 'true';
		root.setAttribute('data-darkmode', dark ? 'true' : 'false');
		try { localStorage.setItem('fs-darkmode', dark ? 'true' : 'false'); } catch (e) {}
	});
}

return baseclass.extend({
	/* entry point: load the menu tree, render mode menu (which drives the
	 * injected renderMainMenu), the section tabs, and wire the theme toggle. */
	bootstrap(renderMainMenu) {
		ui.menu.load().then((tree) => {
			renderModeMenu(tree, renderMainMenu);

			if (L.env.dispatchpath.length >= 3) {
				let node = tree, url = '';
				for (let i = 0; i < 3 && node; i++) {
					node = node.children[L.env.dispatchpath[i]];
					url = url + (url ? '/' : '') + L.env.dispatchpath[i];
				}
				if (node)
					renderTabMenu(node, url);
			}

			wireThemeToggle();
		});
	}
});
