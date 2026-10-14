/* The repo root, and the reads every gate does through it: `read`, `filesIn`, `readAll`. One copy.
 *
 * A per-tool `join(dirname(fileURLToPath(import.meta.url)), '..')` drifts the moment a tool moves
 * between `tools/` and `tools/lib/` and every read fails with ENOENT on a path nobody wrote.
 * mirror.mjs (a MIXED list of files and directories) and minify-js.mjs (roots outside the repo)
 * keep their own walk on purpose. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* lib/ is one level below tools/, which is one below the repo root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* the theme's served resources dir, absolute */
export const RESOURCES = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources');

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
