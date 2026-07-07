'use strict';
'require baseclass';
'require ui';

/* Footstrap sidebar menu renderer (variant 1A).
 * Fills #topmenu vertically, #modemenu (modes), #tabmenu (section tabs),
 * and wires the sidebar theme toggle. Spec: docs/09-realizatsiya-sidebar.md */

const ICONS = {
	status:   '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
	system:   '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
	services: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/>',
	network:  '<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8 16 16 8M8 18h7.5M18 8.5V16"/>',
	vpn:      '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
	docker:   '<rect x="3" y="11" width="4" height="4" rx=".7"/><rect x="8" y="11" width="4" height="4" rx=".7"/><rect x="13" y="11" width="4" height="4" rx=".7"/><rect x="8" y="6" width="4" height="4" rx=".7"/><path d="M18 13c0 4-3 6-8 6-4 0-7-2-7-4"/>',
	_default: '<circle cx="12" cy="12" r="8.5"/>'
};

function iconSvg(name) {
	const key = String(name || '').toLowerCase();
	const body = ICONS[key]
		|| (/vpn|wireguard|openvpn/.test(key) ? ICONS.vpn : null)
		|| (/dock|container|lxc/.test(key) ? ICONS.docker : null)
		|| (/net|wifi|wireless|firewall|dhcp/.test(key) ? ICONS.network : null)
		|| (/serv|dnsmasq|cron/.test(key) ? ICONS.services : null)
		|| (/stat|overview|dash/.test(key) ? ICONS.status : null)
		|| ICONS._default;
	return '<svg class="fs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

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

	/* main sections -> vertical sidebar list (#topmenu) */
	renderMainMenu(tree, url, level) {
		const ul = level ? E('ul', {}) : document.querySelector('#topmenu');
		const children = ui.menu.getChildren(tree);

		if (children.length == 0 || level > 1)
			return E([]);

		/* dispatchpath = [mode, section, subsection, ...]; sections sit at
		 * index (level+1) because the first renderMainMenu call gets the mode. */
		const idx = (level || 0) + 1;

		children.forEach(child => {
			const submenu = this.renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
			const hasSub = !!submenu.firstElementChild;
			const isActive = (L.env.dispatchpath[idx] == child.name);
			const chevron = hasSub
				? '<svg class="fs-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
				: '';

			const link = E('a', {
				'href': hasSub ? '#' : L.url(url, child.name),
				'class': (isActive && !hasSub) ? 'active' : ''
			});
			link.innerHTML = (level ? '' : iconSvg(child.name)) + '<span class="fs-label"></span>' + chevron;
			link.querySelector('.fs-label').textContent = _(child.title);

			const li = E('li', {
				'class': [
					isActive ? 'active' : '',
					hasSub ? 'has-sub' : '',
					(hasSub && isActive) ? 'open' : ''
				].join(' ').trim()
			}, [ link, submenu ]);

			if (hasSub)
				link.addEventListener('click', (ev) => {
					ev.preventDefault();
					li.classList.toggle('open');
				});

			ul.appendChild(li);
		});

		return ul;
	},

	/* section tabs -> #tabmenu (horizontal) */
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

	/* modes (admin/status/...) -> #modemenu; usually single -> hidden */
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

		if (children.length <= 1)
			ul.classList.add('single');
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
