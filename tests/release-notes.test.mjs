import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ROOT } from '../tools/lib/root.mjs';

const EN = [
	'## [Unreleased]', '', '### Development', '', '- **Only tooling.** x', '',
	'## [2.0.0] — 2026-02-01', '', '### Fixed', '', '- **Fix leads.** why', '- **A lead that',
	'  runs on.** more', '', '### Development', '', '- **Hook leads.** h', '- **Gate leads.** g', '',
	'### Performance', '', '- **Perf leads.** p', '',
	'## [1.0.0] — 2026-01-01', '', '### Added', '', '- **Old lead.** z', '',
].join('\n');
const RU = EN.replace('### Fixed', '### Исправлено').replace(/### Development/g, '### Разработка')
	.replace('### Performance', '### Производительность');

/* `release-notes.sh <ver>` over the fixture pair in a scratch dir: the RU mirror sits beside the EN file. */
function notes(ver, en = EN, ru = RU) {
	const dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
	try {
		writeFileSync(join(dir, 'CHANGELOG.md'), en);
		writeFileSync(join(dir, 'CHANGELOG_ru.md'), ru);
		return spawnSync('sh', [join(ROOT, 'tools/release-notes.sh'), ver, join(dir, 'CHANGELOG.md')], { encoding: 'utf8' });
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('release notes keep the Fixed and Performance leads and drop Development, in both languages', () => {
	const r = notes('2.0.0');
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /### Fixed\n- Fix leads\.\n- A lead that runs on\.\n\n### Performance\n- Perf leads\./);
	assert.match(r.stdout, /### Исправлено\n- Fix leads\.\n- A lead that runs on\.\n\n### Производительность\n- Perf leads\./);
	assert.doesNotMatch(r.stdout, /Development|Разработка|Hook leads|Gate leads/);
});

test('a version with only Development entries prints an empty body and no dangling header', () => {
	const r = notes('Unreleased');
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(r.stdout, /###|Only tooling|---/);
	assert.match(r.stdout, /^## luci-theme-footstrap vUnreleased\n/);
});

test('a version the changelog does not have is still a failed release', () => {
	const r = notes('9.9.9');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /no '## \[9\.9\.9\]' section/);
});

test('a mirror without the version is still a failed release', () => {
	const r = notes('2.0.0', EN, RU.replace('## [2.0.0]', '## [2.0.1]'));
	assert.equal(r.status, 1);
	assert.match(r.stderr, /CHANGELOG_ru\.md/);
});
