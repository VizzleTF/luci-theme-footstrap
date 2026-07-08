'use strict';
'require baseclass';
'require ui';
'require menu-footstrap-common as common';

/* Footstrap TOP-nav menu (variant 1B): horizontal #topmenu with one level of
 * hover dropdowns. Shared mode/tab/toggle logic lives in menu-footstrap-common
 * (composed via common.bootstrap). Only renderMainMenu is layout-specific.
 * Spec: docs/10-realizatsiya-topnav.md */

/* main sections -> horizontal top menu with one level of dropdowns */
function renderMainMenu(tree, url, level) {
	const ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu');
	const children = ui.menu.getChildren(tree);

	if (children.length == 0 || level > 1)
		return E([]);

	children.forEach(child => {
		const submenu = renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
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
}

return baseclass.extend({
	__init__() {
		common.bootstrap(renderMainMenu);
	}
});
