/* Extract the inline <script> bodies from a ucode .ut template so ESLint can lint them.
 *
 * WHY THIS EXISTS: the browser JS inside the templates was the ONLY JS in the theme that nothing
 * checked. eslint runs over `htdocs/**` and jsmin (via luci.mk) minifies the same tree; a .ut is
 * copied to the router verbatim, so neither ever looked at it. That left the pre-paint in
 * partials/head.ut — the most load-bearing script in the theme, it stamps :root before the first
 * frame — outside every gate, and its only failure symptom is a wrong frame nobody reports.
 *
 * WHAT IS LINTED: a <script> with a body and NO ucode interpolation (`{{ … }}`, `{% … %}`). Those
 * blocks are plain JS already; the template engine copies them through untouched.
 *
 * WHAT IS NOT, AND WHY IT IS SAFE: a block the server interpolates is not JS until it is rendered
 * — `{{ https_ports }}.forEach(…)` does not parse — so it cannot be handed to a JS parser as-is.
 * Rather than substitute placeholders and lint a fiction, those blocks must be DATA ONLY: a single
 * statement handing a server value to a pure-JS block that IS linted (see head.ut's window.__fsSD
 * and sysauth.ut's window.__fsHttps). `assertDataOnly()` below enforces that, so logic cannot hide
 * in the one shape the linter is blind to.
 *
 * LINE NUMBERS: each body is padded with the newlines and spaces that precede it in the template,
 * so a message's line/column point at the .ut file itself. No remapping in postprocess.
 */

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
