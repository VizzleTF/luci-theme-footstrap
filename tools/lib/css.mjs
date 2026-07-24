/* Build the stylesheet for a gate to measure. ONE copy.
 *
 * The stylesheet is GENERATED (build-css.sh concatenates styles/), so a gate must build it — never
 * measure a stale copy left over from the last run. Three tools said that in three ways and had
 * already drifted three ways: two used mkdtemp and one a fixed name under a shared /tmp, two
 * silenced build-css.sh and one did not, and only css-dup passed --dev. The fixed-name variant is
 * what forced a `name` parameter on the API — callers invented 'cascade-export.css' etc. purely to
 * avoid colliding with each other, which is a knob that exists because the temp dir was not fresh.
 * mkdtemp makes the name a non-question.
 *
 * `dev` keeps comments: css-dup matches @mirror markers, which the squeeze strips.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export { ROOT } from './root.mjs';
import { ROOT } from './root.mjs';

/* -> absolute path of a freshly built cascade.css. stdio: 'inherit' keeps build-css.sh's
 * "N bytes -> path" line, which is worth having in a CI log and harmless locally. */
export function buildCss({ dev = false } = {}) {
	const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'fs-css-'));
	const out = join(dir, 'cascade.css');
	execFileSync(join(ROOT, 'luci-theme-footstrap/build-css.sh'),
		dev ? [out, '--dev'] : [out], { stdio: 'inherit' });
	return out;
}
