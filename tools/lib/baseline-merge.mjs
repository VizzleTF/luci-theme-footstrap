/* Merge one live-audit run into the baseline. `seen` maps stand id → Set of signatures. With
 * `prune`, an entry is dropped only when NO stand of the run reproduced it: a stand without an
 * app's package cannot vouch for that app's entry, another stand of the run can. Without it the
 * result is the union. Returns the next baseline and the dropped `id: sig` keys. */
export function mergeBaseline(baseline, seen, prune) {
	const next = Object.assign({}, baseline), dropped = [];
	const anywhere = new Set(Object.values(seen).flatMap((v) => [ ...v ]));
	for (const id of Object.keys(seen)) {
		const old = baseline[id] || [];
		const keep = prune ? old.filter((sig) => anywhere.has(sig)) : old;
		if (prune) for (const sig of old) if (!anywhere.has(sig)) dropped.push(`${id}: ${sig}`);
		next[id] = [ ...new Set([ ...keep, ...seen[id] ]) ].sort();
	}
	return { next, dropped };
}
