/* THE repo root, and the two things every gate does with it. ONE copy.
 *
 * `join(dirname(fileURLToPath(import.meta.url)), '..')` was written out in ten tools, and
 * `lib/css.mjs` and `lib/gallery.mjs` each exported a THIRD spelling of the same path (one level
 * deeper, so with a different number of '..'). Three levels of truth about where the repo is, none
 * of them wrong yet, all of them free to drift the moment a tool moves between `tools/` and
 * `tools/lib/` — at which point the boilerplate silently resolves one directory off and every
 * read fails with ENOENT pointing at a path nobody wrote.
 *
 * `read` was identical in three tools; `filesIn` is the readdir-recursive + extension filter that
 * had been re-derived five times (axes twice, css-i18n, fs-orphans, minify-js, mirror), each with
 * its own idea of whether directories needed excluding.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* lib/ is one level below tools/, which is one below the repo root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* read a repo-relative path as text */
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* Every file under a repo-relative dir whose name ends in `ext`, as repo-relative paths.
 * `recursive: true` yields directories as well as files, and a directory never ends in an
 * extension — so the extension filter is what excludes them, not a separate stat(). */
export const filesIn = (dir, ext) => readdirSync(join(ROOT, dir), { recursive: true })
	.filter((f) => f.endsWith(ext))
	.map((f) => join(dir, f));
