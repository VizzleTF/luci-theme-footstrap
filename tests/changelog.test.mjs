import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { insertBullet, sealedDrift, sectionText } from '../tools/changelog.mjs';

const CANON = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Performance', 'Development'];
const DOC = [
	'## [Unreleased]', '', '### Changed', '', '- **a.** x', '', '### Fixed', '', '- **b.** y', '',
	'## [1.0.0] — 2026-01-01', '', '### Added', '', '- **c.** z', '',
	'[Unreleased]: https://x/compare/v1.0.0...HEAD', '[1.0.0]: https://x/releases/v1.0.0', '',
].join('\n');

test('sectionText stops at the next heading and at the link list', () => {
	assert.equal(sectionText(DOC, '1.0.0'), '## [1.0.0] — 2026-01-01\n\n### Added\n\n- **c.** z');
	assert.equal(sectionText(DOC, '9.9.9'), null);
});

test('insertBullet appends to an existing section, before the blank line', () => {
	const out = insertBullet(DOC, CANON, 'Changed', '- **n.** new');
	assert.match(out, /### Changed\n\n- \*\*a\.\*\* x\n- \*\*n\.\*\* new\n\n### Fixed/);
});

test('insertBullet creates a missing section in its canonical slot', () => {
	const out = insertBullet(DOC, CANON, 'Added', '- **n.** new');
	assert.match(out, /## \[Unreleased\]\n\n### Added\n\n- \*\*n\.\*\* new\n\n### Changed/);
	const sec = insertBullet(DOC, CANON, 'Security', '- **s.** sec');
	assert.match(sec, /- \*\*b\.\*\* y\n\n### Security\n\n- \*\*s\.\*\* sec\n\n## \[1\.0\.0\]/);
});

test('insertBullet puts Development last, after Performance and everything else', () => {
	const out = insertBullet(DOC, CANON, 'Development', '- **d.** dev');
	assert.match(out, /- \*\*b\.\*\* y\n\n### Development\n\n- \*\*d\.\*\* dev\n\n## \[1\.0\.0\]/);
	const perf = insertBullet(out, CANON, 'Performance', '- **p.** perf');
	assert.match(perf, /### Performance\n\n- \*\*p\.\*\* perf\n\n### Development/);
});

test('add refuses an index past Development (7) before it writes anything', () => {
	const bin = fileURLToPath(new URL('../tools/changelog.mjs', import.meta.url));
	for (const i of [8, -1]) {
		const r = spawnSync(process.execPath, [bin, 'add', String(i), '--en', '- **a.** b', '--ru', '- **a.** b'], { encoding: 'utf8' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /usage: changelog\.mjs add <0-7>/);
	}
});

test('insertBullet never touches a released section', () => {
	const out = insertBullet(DOC, CANON, 'Fixed', '- **n.** new');
	assert.equal(sectionText(out, '1.0.0'), sectionText(DOC, '1.0.0'));
	assert.throws(() => insertBullet(DOC, CANON, 'Nope', '- **n.** x'), /unknown section/);
});

test('insertBullet brings back a missing [Unreleased] above the newest release', () => {
	const bare = DOC.slice(DOC.indexOf('## [1.0.0]'));
	const out = insertBullet(bare, CANON, 'Fixed', '- **n.** new');
	assert.match(out, /^## \[Unreleased\]\n\n### Fixed\n\n- \*\*n\.\*\* new\n\n## \[1\.0\.0\]/);
	assert.throws(() => insertBullet('no headings\n', CANON, 'Fixed', '- **n.** x'), /no `## \[` heading/);
});

test('insertBullet puts one blank line between an empty ### heading and its bullet', () => {
	const out = insertBullet('## [Unreleased]\n\n### Fixed\n\n## [1.0.0] — 2026-01-01\n', CANON, 'Fixed', '- **n.** new');
	assert.match(out, /### Fixed\n\n- \*\*n\.\*\* new\n\n## \[1\.0\.0\]/);
});

test('sealedDrift flags an entry that landed in the newest released section', () => {
	const tagged = () => DOC;
	assert.deepEqual(sealedDrift('f', DOC, tagged), []);
	const stray = DOC.replace('- **c.** z', '- **c.** z\n- **stray.** s');
	assert.deepEqual(sealedDrift('f', stray, tagged), ['1.0.0']);
});

test('sealedDrift skips a missing tag and leaves older releases alone', () => {
	assert.deepEqual(sealedDrift('f', DOC, () => null), []);
	const two = DOC.replace('[Unreleased]: ', '## [0.9.0] — 2025-01-01\n\n### Added\n\n- **o.** old\n\n[Unreleased]: ');
	const edited = two.replace('- **o.** old', '- **o.** old2');
	assert.deepEqual(sealedDrift('f', edited, () => two), []);
});
