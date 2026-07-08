'use strict';
'require ui';
'require view';

/* Footstrap login — render the stock LuCI login form as a centered card.
 * No custom copy, no extra widgets: just the default Authorization Required
 * title + Username/Password fields + Log in button, laid out cleanly. */

return view.extend({
	render() {
		const section = document.querySelector('section');
		const form = section.querySelector('form');
		const btn = section.querySelector('button');
		const alert = section.querySelector('.alert-message');

		const card = E('div', { 'class': 'fs-login' }, [
			E('div', { 'class': 'fs-login-title' }, _('Authorization Required')),
			form
		]);
		if (alert) card.appendChild(alert);
		card.appendChild(btn);

		const view = document.querySelector('#view');
		view.innerHTML = '';
		view.appendChild(E('div', { 'class': 'fs-login-wrap' }, [ card ]));

		form.addEventListener('keypress', (ev) => {
			if (ev.key === 'Enter') { ev.preventDefault(); btn.click(); }
		});

		btn.addEventListener('click', () => {
			card.querySelectorAll('.cbi-value, .fs-login-title, button, .alert-message').forEach((n) => n.style.display = 'none');
			card.appendChild(E('div', { 'class': 'spinning' }, _('Logging in…')));
			form.submit();
		});

		const pw = form.querySelector('input[type="password"]');
		if (pw) pw.focus();

		return '';
	},

	addFooter() {}
});
