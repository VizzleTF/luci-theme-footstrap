/* Build the stylesheet for a tool to read. One copy.
 *
 * The stylesheet is GENERATED (build-css.sh concatenates styles/), so a tool must build it rather
 * than read a stale copy. mkdtemp makes the output name a non-question: a fixed name under a
 * shared /tmp made callers invent names to avoid colliding, so do not re-add a `name` knob. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT } from './root.mjs';

/* A fresh scratch dir, removed when the process exits (a run leaked one per build before). */
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

/* -> absolute path of a freshly built cascade.css. stdio: 'inherit' keeps build-css.sh's
 * "N bytes -> path" line, which is worth having in a CI log and harmless locally. */
export function buildCss() {
	const out = join(scratchDir('fs-css-'), 'cascade.css');
	execFileSync(join(ROOT, 'luci-theme-footstrap/build-css.sh'), [out], { stdio: 'inherit' });
	return out;
}
