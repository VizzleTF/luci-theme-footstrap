'use strict';
'require baseclass';
'require ui';

/* Theme plain LuCI <select> fields (ui.Select, widget:'select') by rendering a
 * styled cbi-dropdown beside them — native <select> popups can't be CSS-styled.
 *
 * The native <select> stays the form field / source of truth. It MUST remain
 * frameEl.firstChild: ui.Select.getValue() returns `this.node.firstChild.value`
 * and setValue() writes `this.node.firstChild.options`. Inserting our widget
 * BEFORE the select made getValue read a <div> and return `undefined`, which
 * broke Save. So we insert AFTER the select (it stays firstChild) and mirror the
 * value both ways. Living inside the same frameEl also ties our node to the
 * widget's lifecycle, so a CBI re-render disposes of it — no orphaned widgets.
 *
 * Runs theme-wide (required from the footer) and watches for selects added later
 * by client-side CBI. */

function readChoices(sel) {
	const choices = {};
	Array.prototype.forEach.call(sel.options, (o) => { choices[o.value] = o.textContent; });
	return choices;
}

function enhance(sel) {
	if (sel.multiple || sel.dataset.fsSelect || sel.disabled) return;
	if (!sel.closest('.cbi-value-field, .td.cbi-value-field, .cbi-value')) return;

	const choices = readChoices(sel);

	let dd;
	try {
		dd = new ui.Dropdown(sel.value, choices, {
			sort: false,
			optional: Object.prototype.hasOwnProperty.call(choices, '')
		});
	} catch (e) { return; }

	const node = dd.render();
	sel.dataset.fsSelect = '1';
	sel.style.display = 'none';

	/* AFTER the select: it must stay frameEl.firstChild for ui.Select to read
	 * its value on save. */
	sel.parentNode.insertBefore(node, sel.nextSibling);

	/* `syncing` stops our own dd->sel dispatch from echoing back through the
	 * sel->dd listener. */
	let syncing = false;

	/* our widget -> native select (user picked an option) */
	node.addEventListener('cbi-dropdown-change', () => {
		const v = dd.getValue();
		if (sel.value === v) return;
		syncing = true;
		sel.value = v;
		sel.dispatchEvent(new Event('change', { bubbles: true }));
		syncing = false;
	});

	/* native select -> our widget (a script/CBI dependency changed & dispatched
	 * change on the select) — keep the visible widget from going stale. */
	sel.addEventListener('change', () => {
		if (syncing) return;
		if (dd.getValue() !== sel.value)
			dd.setValue(sel.value);
	});
}

return baseclass.extend({
	__init__() {
		const scan = () => document.querySelectorAll('select.cbi-input-select:not([data-fs-select])').forEach(enhance);
		scan();

		let pending = false;
		new MutationObserver(() => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; scan(); });
		}).observe(document.body, { childList: true, subtree: true });
	}
});
