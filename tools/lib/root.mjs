/* The repo root, and the read the tools do through it. One copy.
 *
 * A per-tool `join(dirname(fileURLToPath(import.meta.url)), '..')` drifts the moment a tool moves
 * between `tools/` and `tools/lib/` and every read fails with ENOENT on a path nobody wrote.
 * minify-js.mjs (roots outside the repo) keeps its own walk on purpose. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* lib/ is one level below tools/, which is one below the repo root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* read a repo-relative path as text */
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
