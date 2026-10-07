import test from 'node:test';
import assert from 'node:assert/strict';

import { insertBullet, sealedDrift, sectionText } from '../tools/changelog.mjs';

const CANON = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Performance'];
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

test('insertBullet never touches a released section', () => {
	const out = insertBullet(DOC, CANON, 'Fixed', '- **n.** new');
	assert.equal(sectionText(out, '1.0.0'), sectionText(DOC, '1.0.0'));
	assert.throws(() => insertBullet(DOC, CANON, 'Nope', '- **n.** x'), /unknown section/);
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
