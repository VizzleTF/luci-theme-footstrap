/* Extract the inline <script> bodies from a ucode .ut template so ESLint can lint them.
 *
 * The browser JS inside the templates is otherwise the only JS in the theme that nothing checks:
 * eslint runs over `htdocs/**` and jsmin minifies the same tree, while a .ut is copied to the
 * router verbatim. That leaves the pre-paint in partials/head.ut — the most load-bearing script in
 * the theme, stamping :root before the first frame — outside every gate, with a wrong frame nobody
 * reports as its only failure symptom. */

/* <script> with no `src`. `[^>]*` covers attributes we do use (`data-fs-shell` is on <style>, but
 * a future <script> attribute must not silently drop the block from the lint). */
const SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const INTERPOLATED = /\{\{|\{%/;

/* A block the linter cannot see must not think. Anything beyond assignments — a keyword that
 * branches, loops, declares or calls back — belongs in a pure block that IS linted. */
const LOGIC = /\b(?:if|else|for|while|do|switch|try|catch|function|return|=>)\b|=>/;

export function extractScripts(text) {
	const out = [];
	for (const m of text.matchAll(SCRIPT)) {
		const body = m[1];
		if (!body.trim()) continue;
		const start = m.index + m[0].indexOf(body);
		const before = text.slice(0, start);
		const line = before.split('\n').length;
		const col = start - (before.lastIndexOf('\n') + 1);
		out.push({ body, start, line, col, interpolated: INTERPOLATED.test(body) });
	}
	return out;
}

/* An interpolated block is exempt from the lint, so it has to earn the exemption: one statement,
 * no control flow. `window.__fsSD={…};` passes; a branch on a server value does not. */
export function assertDataOnly(block, filename) {
	const src = block.body.trim();
	if (LOGIC.test(src))
		throw new Error(
			`${filename}:${block.line}: an interpolated <script> is not linted (it is not JS until ` +
			`rendered), so it must be DATA ONLY — hand the server value to a pure-JS block instead ` +
			`(see head.ut's window.__fsSD).`
		);
	if (src.split(';').filter((s) => s.trim()).length > 1)
		throw new Error(
			`${filename}:${block.line}: an interpolated <script> must be a SINGLE data statement; ` +
			`this one has several. Move the logic into a pure-JS block, which the linter can see.`
		);
}

export const utProcessor = {
	meta: { name: 'ut-inline-script', version: '1.0.0' },
	supportsAutofix: false,
	preprocess(text, filename) {
		const out = [];
		let i = 0;
		for (const block of extractScripts(text)) {
			if (block.interpolated) { assertDataOnly(block, filename); continue; }
			/* pad to the body's exact offset: line/column then need no remapping */
			out.push({
				text: '\n'.repeat(block.line - 1) + ' '.repeat(block.col) + block.body,
				filename: `${i++}.js`,
			});
		}
		return out;
	},
	postprocess(messages) {
		return messages.flat();
	},
};
