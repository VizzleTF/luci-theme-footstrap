/* The repo root, and the reads every gate does through it: `read`, `filesIn`, `readAll`. One copy.
 *
 * `join(dirname(fileURLToPath(import.meta.url)), '..')` written out per tool is three levels of
 * truth about where the repo is, all free to drift the moment a tool moves between `tools/` and
 * `tools/lib/` — at which point the boilerplate resolves one directory off and every read fails
 * with ENOENT pointing at a path nobody wrote.
 *
 * Two callers stay on their own walk on purpose: mirror.mjs takes a MIXED list of files and
 * directories, and minify-js.mjs takes roots outside the repo (it runs over the staged payload). */
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

/* Every such file's text, newline-joined — a whole tree as ONE string. That is what a gate wants
 * when the question is "does the theme, anywhere, do X": a named file goes stale the moment the
 * code moves to a sibling module, which is the failure chrome-fence.mjs's own header records. */
export const readAll = (dir, ext) => filesIn(dir, ext).map(read).join('\n');
