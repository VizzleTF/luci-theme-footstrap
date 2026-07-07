'use strict';
'require baseclass';
'require ui';

/* Footstrap TOP-nav menu renderer (variant 1B / bootstrap-style).
 * Horizontal main menu in #topmenu with dropdowns; #tabmenu tabs, #modemenu
 * modes, and the header theme toggle. Spec: docs/10-realizatsiya-topnav.md */

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => {
			this.render(tree);
			this.wireThemeToggle();
		});
	},

	render(tree) {
		this.renderModeMenu(tree);

		if (L.env.dispatchpath.length >= 3) {
			let node = tree, url = '';
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}
			if (node)
				this.renderTabMenu(node, url);
		}
	},

	/* horizontal top menu with one level of dropdowns */
	renderMainMenu(tree, url, level) {
		const ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu');
		const children = ui.menu.getChildren(tree);

		if (children.length == 0 || level > 1)
			return E([]);

		children.forEach(child => {
			const submenu = this.renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
			const hasSub = !level && submenu.firstElementChild;
			const subclass = hasSub ? 'dropdown' : '';
			const linkclass = hasSub ? 'menu' : '';
			const linkurl = hasSub ? '#' : L.url(url, child.name);
			const active = (L.env.dispatchpath[(level || 0) + 1] == child.name);

			const li = E('li', { 'class': (subclass + (active ? ' active' : '')).trim() }, [
				E('a', { 'class': linkclass, 'href': linkurl }, [ _(child.title) ]),
				submenu
			]);

			ul.appendChild(li);
		});

		ul.style.display = '';
		return ul;
	},

	renderTabMenu(tree, url, level) {
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
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	},

	renderModeMenu(tree) {
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
				this.renderMainMenu(child, child.name);
		});

		if (ul.children.length > 1)
			ul.style.display = '';
	},

	wireThemeToggle() {
		const btn = document.getElementById('fs-theme-toggle');
		if (!btn) return;
		btn.addEventListener('click', () => {
			const root = document.querySelector(':root');
			const dark = root.getAttribute('data-darkmode') !== 'true';
			root.setAttribute('data-darkmode', dark ? 'true' : 'false');
			try { localStorage.setItem('fs-darkmode', dark ? 'true' : 'false'); } catch (e) {}
		});
	}
});
