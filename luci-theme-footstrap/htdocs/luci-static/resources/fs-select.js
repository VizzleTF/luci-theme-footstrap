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

/* cheap identity of the option list, to detect a script rebuilding it
 * (select.replaceChildren, dependency-driven re-population, …) */
function choicesKey(sel) {
	return Array.prototype.map.call(sel.options, (o) => o.value + '\u0000' + o.textContent).join('\u0001');
}

/* undo enhance(): drop the widget, unhide the native select */
function teardown(sel) {
	if (sel._fsNode && sel._fsNode.parentNode)
		sel._fsNode.parentNode.removeChild(sel._fsNode);
	delete sel.dataset.fsSelect;
	sel._fsDd = sel._fsNode = sel._fsKey = null;
	sel.style.display = '';
}

/* keep an enhanced select and its widget in step when a script drives the
 * native element directly: ui.Select.setValue() rewrites value/options WITHOUT
 * dispatching `change`, so the change-event mirror in enhance() never fires and
 * the visible widget went stale (showed the old value while Save read the new
 * one). Runs from the scan() pass on every observed mutation. */
function resync(sel) {
	const dd = sel._fsDd;
	if (!dd || !sel._fsNode) return;
	if (sel.disabled) { teardown(sel); return; }	/* disabled later: back to native */
	const key = choicesKey(sel);
	if (key !== sel._fsKey) {
		/* option list rebuilt — recreate the widget from the fresh options */
		teardown(sel);
		enhance(sel);
		return;
	}
	if (dd.getValue() !== sel.value)
		dd.setValue(sel.value);
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
	sel._fsDd = dd;
	sel._fsNode = node;
	sel._fsKey = choicesKey(sel);

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

/* Tag standalone data tables so the responsive (&lt;820px) stacking rules can key
 * off a static `.fs-dt` class instead of a live `:has(.tr.table-titles)` that the
 * style engine re-evaluated on every mutation of these polled tables
 * (Processes/routes/leases). Match = <table class="table"> with a table-titles
 * header, not a .cbi-section-table (config forms keep their own layout). */
function tagDataTables() {
	document.querySelectorAll('#view table.table:not(.cbi-section-table):not(.fs-dt)').forEach((t) => {
		if (t.querySelector('.tr.table-titles'))
			t.classList.add('fs-dt');
	});
}

return baseclass.extend({
	__init__() {
		const scan = () => {
			document.querySelectorAll('select.cbi-input-select:not([data-fs-select])').forEach(enhance);
			document.querySelectorAll('select.cbi-input-select[data-fs-select]').forEach(resync);
			tagDataTables();
		};
		scan();

		let pending = false;
		new MutationObserver(() => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => { pending = false; scan(); });
		}).observe(document.body, {
			childList: true, subtree: true,
			/* `disabled` flips and attr-driven value writes never mutate childList;
			 * watch them so resync()/enhance() notice (filtered — cheap) */
			attributes: true, attributeFilter: [ 'disabled', 'value', 'selected' ]
		});
	}
});
