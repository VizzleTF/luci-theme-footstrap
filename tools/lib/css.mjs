/* Build the stylesheet for a gate to measure. One copy.
 *
 * The stylesheet is GENERATED (build-css.sh concatenates styles/), so a gate must build it rather
 * than measure a stale copy. mkdtemp makes the output name a non-question: a fixed name under a
 * shared /tmp made callers invent names to avoid colliding, so do not re-add a `name` knob. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT } from './root.mjs';

/* A fresh scratch dir, removed when the process exits (a gate run leaked one per build before). */
export function scratchDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	const clean = () => rmSync(dir, { recursive: true, force: true });
	process.once('exit', clean);
	/* A signal skips 'exit' handlers: clean, then leave the way the shell reports a signalled child. */
	for (const [ sig, no ] of [ [ 'SIGINT', 2 ], [ 'SIGTERM', 15 ] ]) {
		process.once(sig, () => { clean(); process.exit(128 + no); });
	}
	return dir;
}

/* The seam of every `shipped` sheet this process built, by sheet path: { names: Map(--fs-x -> --a),
 * gallery: docs/gallery.html with the same rename }. A page that reads a private name is the far side
 * of the seam (mangle-tokens.sh renames the JS and templates the same way), so a gate that stamps or
 * reads one asks `names`, and serveGallery serves `gallery`. */
const SEAMS = new Map();
export const seamOf = (cssPath) => SEAMS.get(cssPath);

/* Run the package's own mangle-tokens.sh over `out`. Its far side is a scratch dir holding every
 * private name the sheet spells (as a JSON list) and the gallery; the script renames both in place
 * with the sheet's map, so the map is read back from what it did, never re-derived here. */
function mangle(out, script, dir) {
	const seam = join(dir, 'seam');
	const names = [...new Set(readFileSync(out, 'utf8').match(/--fs-[A-Za-z0-9_-]+/g))];
	mkdirSync(seam);
	writeFileSync(join(seam, 'names.js'), JSON.stringify(names));
	writeFileSync(join(seam, 'gallery.ut'), readFileSync(join(ROOT, 'docs/gallery.html')));
	execFileSync(script, [out, seam], { stdio: 'inherit' });
	const short = JSON.parse(readFileSync(join(seam, 'names.js'), 'utf8'));
	SEAMS.set(out, {
		names: new Map(names.map((n, i) => [n, short[i]])),
		gallery: readFileSync(join(seam, 'gallery.ut'), 'utf8'),
	});
}

/* -> absolute path of a freshly built cascade.css. `dev` keeps comments: css-dup matches @mirror
 * markers, which the squeeze strips. `shipped` runs mangle-tokens.sh after build-css.sh, the two
 * steps a router's sheet goes through (Makefile, tools/stage.sh), so a gate measures the bytes the
 * package ships; computed-diff does, the rest measure the readable sheet. `ref` builds a git ref
 * instead of the worktree, scripts and all: `git archive` gives exactly build-css.sh, mangle-tokens.sh
 * and styles/ beside it, reads neither index nor worktree, and takes the ref as an argv entry, never
 * through a shell. stdio: 'inherit' keeps the scripts' "N bytes -> path" lines, which are worth having
 * in a CI log and harmless locally. */
export function buildCss({ dev = false, ref, shipped = false } = {}) {
	const dir = scratchDir('fs-css-');
	const out = join(dir, 'cascade.css');
	const pkg = 'luci-theme-footstrap';
	let tree = join(ROOT, pkg);
	if (ref) {
		execFileSync('tar', ['-x', '-C', dir], {
			input: execFileSync('git', ['archive', ref, pkg + '/build-css.sh', pkg + '/styles', ...(shipped ? [pkg + '/mangle-tokens.sh'] : [])],
				{ cwd: ROOT, maxBuffer: Infinity }),
		});
		tree = join(dir, pkg);
	}
	execFileSync(join(tree, 'build-css.sh'), dev ? [out, '--dev'] : [out], { stdio: 'inherit' });
	if (shipped) mangle(out, join(tree, 'mangle-tokens.sh'), dir);
	return out;
}
