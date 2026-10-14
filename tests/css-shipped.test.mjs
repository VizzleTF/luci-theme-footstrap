import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCss, seamOf } from '../tools/lib/css.mjs';

test('a shipped sheet is the mangled one, and the gallery is renamed with its map', () => {
	const out = buildCss({ shipped: true });
	const { names, gallery } = seamOf(out);
	const short = names.get('--fs-accent');
	assert.match(short, /^--[A-Za-z]{1,2}$/);
	assert.ok(readFileSync(out, 'utf8').includes(`var(${short})`));
	assert.doesNotMatch(readFileSync(out, 'utf8'), /var\(--fs-/);
	assert.doesNotMatch(gallery, /var\(--fs-/);
	assert.ok(gallery.includes(`var(${names.get('--fs-bg')})`), 'the gallery reads --fs-bg through the seam');
});

test('a plain sheet has no seam, and a ref build takes mangle-tokens.sh from the ref', () => {
	assert.equal(seamOf(buildCss()), undefined);
	const out = buildCss({ ref: 'HEAD', shipped: true });
	assert.ok(seamOf(out).names.size > 100);
	assert.doesNotMatch(readFileSync(out, 'utf8'), /var\(--fs-/);
});
