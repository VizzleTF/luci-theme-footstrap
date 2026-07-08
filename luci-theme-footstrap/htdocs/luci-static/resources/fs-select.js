'use strict';
'require baseclass';
'require ui';

/* Enhance plain LuCI <select> fields into the styled cbi-dropdown widget so
 * their OPEN list is themed too (native <select> popups can't be CSS-styled).
 *
 * The native <select> stays in the DOM (hidden) as the form field / source of
 * truth — CBI save/validation/dependencies read it unchanged. A ui.Dropdown is
 * rendered next to it and mirrored back on change. Runs theme-wide (required
 * from the footer) and watches for selects added later by client-side CBI. */

function enhance(sel) {
	if (sel.multiple || sel.dataset.fsSelect || sel.disabled) return;
	if (!sel.closest('.cbi-value-field, .td.cbi-value-field, .cbi-value')) return;

	const choices = {};
	Array.prototype.forEach.call(sel.options, (o) => { choices[o.value] = o.textContent; });

	let dd;
	try { dd = new ui.Dropdown(sel.value, choices, { sort: false, optional: false }); }
	catch (e) { return; }

	const node = dd.render();
	sel.dataset.fsSelect = '1';
	sel.style.display = 'none';
	sel.parentNode.insertBefore(node, sel);

	node.addEventListener('cbi-dropdown-change', () => {
		const v = dd.getValue();
		if (sel.value !== v) {
			sel.value = v;
			sel.dispatchEvent(new Event('change', { bubbles: true }));
		}
	});
}

return baseclass.extend({
	__init__() {
		const scan = () => document.querySelectorAll('select.cbi-input-select:not([data-fs-select])').forEach(enhance);
		scan();

		let pending = false;
		const obs = new MutationObserver(() => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; scan(); });
		});
		obs.observe(document.body, { childList: true, subtree: true });
	}
});
