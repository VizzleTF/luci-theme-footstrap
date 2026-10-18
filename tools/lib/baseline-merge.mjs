import { coreId } from './stands.mjs';

/* Every signature any stand of the run or any --seen-in file reproduced: the one rule --prune keeps by. */
const seenAnywhere = (seen, elsewhere = {}) => new Set(
	[ ...Object.values(seen), ...Object.values(elsewhere) ].flatMap((v) => [ ...v ]));

/* Merge one live-audit run into the baseline. `seen` maps stand id → Set of signatures. With
 * `prune`, an entry is dropped only when NO stand of the run reproduced it: a stand without an
 * app's package cannot vouch for that app's entry, another stand of the run can. Without it the
 * result is the union. `elsewhere` ({key: [sig]}, from --seen-in) vouches like a stand does: a CI
 * runner has apps a dev machine lacks. Returns the next baseline and the dropped `id: sig` keys. */
export function mergeBaseline(baseline, seen, prune, elsewhere = {}) {
	const next = Object.assign({}, baseline), dropped = [];
	const anywhere = seenAnywhere(seen, elsewhere);
	for (const id of Object.keys(seen)) {
		const old = baseline[id] || [];
		const keep = prune ? old.filter((sig) => anywhere.has(sig)) : old;
		if (prune) for (const sig of old) if (!anywhere.has(sig)) dropped.push(`${id}: ${sig}`);
		next[id] = [ ...new Set([ ...keep, ...seen[id] ]) ].sort();
	}
	return { next, dropped };
}

/* `stale`: entries not reproduced on their own key. `wouldDrop`: those --prune drops, i.e. seen
 * nowhere (mergeBaseline's rule). Only keys the run measured are judged. */
export function staleCounts(baseline, seen, elsewhere = {}) {
	const anywhere = seenAnywhere(seen, elsewhere);
	let stale = 0, wouldDrop = 0;
	for (const id of Object.keys(seen))
		for (const sig of baseline[id] || [])
			if (!seen[id].has(sig)) { stale++; if (!anywhere.has(sig)) wouldDrop++; }
	return { stale, wouldDrop };
}

/* The baseline key of a stand: the core stand's id, so a twin is judged against the core's set,
 * plus `@lang`/`@engine` when they are not the defaults (live-audit.mjs). */
export const baselineKey = (id, lang, engine) =>
	[ coreId(id), lang !== 'en' && lang, engine !== 'chromium' && engine ].filter(Boolean).join('@');

/* Opens the key's seen set without clobbering one a core stand already filled, and returns it. */
export const openSeen = (seen, key) => (seen[key] ??= new Set());

/* Records one signature; a signature outside the key's baseline and not yet seen is NEW. */
export const noteFinding = (seen, baseline, fresh, key, sig, by) => {
	const s = openSeen(seen, key);
	if (!s.has(sig) && !(baseline[key] || []).includes(sig)) fresh.push({ stand: key, sig, by });
	s.add(sig);
};

/* The `--seen-out` payload: {baselineKey: [signature,...]}, sorted so two runs diff cleanly. */
export const seenToJson = (seen) =>
	Object.fromEntries(Object.keys(seen).sort().map((k) => [ k, [ ...seen[k] ].sort() ]));

/* Reads `--seen-in` files (comma-separated) into one {key: [sig]} map; a bad file is fatal. */
export function readSeenIn(list, read) {
	const out = {};
	for (const f of list.split(',').filter(Boolean))
		for (const [ k, v ] of Object.entries(JSON.parse(read(f)))) out[k] = [ ...(out[k] || []), ...v ];
	return out;
}

/* A page the run skipped (no #view) is absent from `seen`, so --prune would drop its entries as
 * fixed. Returns the `key path` of each skipped page the baseline still holds entries for. */
export const prunable = (baseline, skipped) =>
	skipped.filter(({ key, path }) => (baseline[key] || []).some((s) => s.startsWith(`${path}|`)))
		.map(({ key, path }) => `${key} ${path}`);

/* Every page, every width: the only run that may rewrite the baseline. `widths` is undefined unless passed. */
export const isFullSweep = (f) => !f.pages && f.widths === undefined && f['pages-all'];
