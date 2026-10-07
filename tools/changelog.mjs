#!/usr/bin/env node
/* The changelog contract (docs/releasing.md), held by a machine, because it drifts silently and the
 * release page is generated from it.
 *
 * The bug this exists for, found by hand while cutting 0.9.2: `[Unreleased]` had accumulated a
 * DUPLICATE `### Changed` (and `Fixed` sat before `Removed`) across several commits, each of which
 * looked fine on its own, and `tools/release-notes.sh` prints a header the first time it meets each
 * `###` — so the release page would have carried two "Changed" groups. Nothing failed, the notes
 * being generated at tag time, by which point the tag is pushed and the page published.
 *
 * A gate rather than a review, because every fault here is invisible in the diff that causes it.
 * The prose is deliberately NOT checked: what makes an entry worth reading is beyond a scanner,
 * so this holds the mechanical half — the half that breaks the generator. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ROOT } from './lib/root.mjs';

/* Keep a Changelog's order, `Performance` appended (docs/releasing.md). The RU mirror's names are the same
 * list in the same order — that is what lets the two files be compared by INDEX rather than by
 * name, so only the prose language may differ. */
const CANON = {
	'CHANGELOG.md':    ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Performance'],
	'CHANGELOG_ru.md': ['Добавлено', 'Изменено', 'Устарело', 'Удалено', 'Исправлено', 'Безопасность', 'Производительность'],
};

/* A released section's raw text: its heading down to the next heading or the link list. */
export function sectionText(text, id) {
	const lines = text.split('\n');
	const a = lines.findIndex(l => l.startsWith(`## [${id}]`));
	if (a < 0) return null;
	let b = a + 1;
	while (b < lines.length && !/^## \[|^\[[^\]]+\]:\s*\S/.test(lines[b])) b++;
	return lines.slice(a, b).join('\n').trimEnd();
}

/* Insert `bullet` as the last bullet of `### section` under [Unreleased], creating the section in
 * its canonical slot when absent. Pure text in, text out. */
export function insertBullet(text, canon, section, bullet) {
	if (!canon.includes(section)) throw new Error(`unknown section \`${section}\` — one of ${canon.join('/')}`);
	const lines = text.split('\n');
	const u = lines.findIndex(l => l.startsWith('## [Unreleased]'));
	if (u < 0) throw new Error('no [Unreleased] heading');
	let end = u + 1;
	while (end < lines.length && !/^## \[|^\[[^\]]+\]:\s*\S/.test(lines[end])) end++;
	const heads = [];
	for (let i = u + 1; i < end; i++) {
		const m = lines[i].match(/^### (.+)$/);
		if (m) heads.push({ name: m[1].trim(), at: i });
	}
	const h = heads.find(x => x.name === section);
	if (h) {
		const next = heads.find(x => x.at > h.at);
		let at = next ? next.at : end;
		while (lines[at - 1].trim() === '') at--;
		lines.splice(at, 0, bullet);
	} else {
		const rank = canon.indexOf(section);
		const next = heads.find(x => canon.indexOf(x.name) > rank);
		let at = next ? next.at : end;
		while (at > u + 1 && lines[at - 1].trim() === '') at--;
		lines.splice(at, 0, '', `### ${section}`, '', bullet);
	}
	return lines.join('\n');
}

/* THE REBASE SCAR: a released section must equal that section at its tag. `pull --rebase` once
 * landed an entry inside the tagged [0.14.14]; a cherry-pick put one under the wrong `###`.
 * Neither shows in the diff that did it. Only the NEWEST release is held: that is where an entry
 * strays (until the next tag), and 0.7-0.14 carry 24 legitimate post-tag edits a gate must not
 * rewrite. A tag absent locally, or from before the file, is skipped. */
export function sealedDrift(file, text, tagged) {
	const out = [];
	const newest = [...text.matchAll(/^## \[([^\]]+)\]/gm)].map(m => m[1]).find(id => id !== 'Unreleased');
	for (const id of newest ? [newest] : []) {
		const old = tagged(`v${id}`, file);
		if (old == null) continue;
		const was = sectionText(old, id), now = sectionText(text, id);
		if (was !== null && was !== now) out.push(id);
	}
	return out;
}

const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/* `changelog.mjs add <idx> --en "- **…**" --ru "- **…**"`: put one bullet pair into [Unreleased] of
 * both files, in the worktree AND in the index only (never other staged or unstaged edits), so a
 * commit can be split per entry. <idx> is the section's canonical index, 0 = Added … 6 = Performance. */
function addPair(argv) {
	const idx = Number(argv[0]);
	const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? '' : argv[i + 1] ?? ''; };
	const pair = { 'CHANGELOG.md': flag('--en'), 'CHANGELOG_ru.md': flag('--ru') };
	if (!Number.isInteger(idx) || idx < 0 || idx > 6 || !Object.values(pair).every(b => b.startsWith('- **')))
		throw new Error('usage: changelog.mjs add <0-6> --en "- **lead.** …" --ru "- **lead.** …"');
	for (const [file, bullet] of Object.entries(pair)) {
		const canon = CANON[file], sec = canon[idx];
		const work = readFileSync(join(ROOT, file), 'utf8');
		let staged;
		try { staged = git('show', `:${file}`); } catch { staged = work; }
		writeFileSync(join(ROOT, file), insertBullet(work, canon, sec, bullet));
		const oid = execFileSync('git', ['-C', ROOT, 'hash-object', '-w', '--stdin'],
			{ input: insertBullet(staged, canon, sec, bullet), encoding: 'utf8' }).trim();
		git('update-index', '--cacheinfo', `100644,${oid},${file}`);
		console.log(`changelog: ${file} <- ### ${sec}`);
	}
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

function gate() {
	const fails = [];
	const fail = (file, line, msg) => fails.push(`${file}:${line}: ${msg}`);

	/* Parse into versions -> sections -> bullets. A bullet is a top-level `- ` at column 0; the
	 * rationale that follows it is indented, so it never counts as one. */
	function parse(file) {
		const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
		const versions = [];
		const links = new Map();
		let ver = null, sec = null;

		lines.forEach((line, i) => {
			const n = i + 1;
			let m;
			if ((m = line.match(/^## \[([^\]]+)\](.*)$/))) {
				ver = { id: m[1], rest: m[2], line: n, sections: [] };
				versions.push(ver);
				sec = null;
				return;
			}
			if ((m = line.match(/^### (.+)$/)) && ver) {
				sec = { name: m[1].trim(), line: n, bullets: [] };
				ver.sections.push(sec);
				return;
			}
			if (line.startsWith('- ') && sec) sec.bullets.push({ text: line, line: n });
			/* the reference-style link list at the foot: `[0.9.2]: https://…` */
			if ((m = line.match(/^\[([^\]]+)\]:\s*(\S+)/))) links.set(m[1], { url: m[2], line: n });
		});
		return { versions, links };
	}

	for (const [file, canon] of Object.entries(CANON)) {
		const { versions, links } = parse(file);
		const tagged = (tag, f) => { try { return git('show', `${tag}:${f}`); } catch { return null; } };
		for (const id of sealedDrift(file, readFileSync(join(ROOT, file), 'utf8'), tagged))
			fail(file, 1, `[${id}] differs from its section at tag v${id} — a released section is sealed ` +
				`(a rebase or cherry-pick moved an entry into it?); \`git diff v${id} -- ${file}\``);

		if (!versions.length) { fail(file, 1, 'no `## [version]` headings at all'); continue; }
		if (versions[0].id !== 'Unreleased' && !versions.some(v => v.id === 'Unreleased')) {
			/* not a fault: a freshly cut release has no [Unreleased] until the next commit */
		} else if (versions[0].id !== 'Unreleased' && versions.some(v => v.id === 'Unreleased')) {
			fail(file, versions.find(v => v.id === 'Unreleased').line,
				'[Unreleased] is not the first heading — the file is newest-first');
		}

		for (const v of versions) {
			/* a released version carries its date; [Unreleased] must not pretend to have one */
			if (v.id === 'Unreleased') {
				if (v.rest.trim()) fail(file, v.line, '[Unreleased] must carry no date');
			} else if (!/^\s*—\s*\d{4}-\d{2}-\d{2}/.test(v.rest)) {
				fail(file, v.line, `[${v.id}] has no \`— YYYY-MM-DD\` date`);
			}

			const names = v.sections.map(s => s.name);
			for (const s of v.sections) {
				if (!canon.includes(s.name))
					fail(file, s.line, `[${v.id}] unknown section \`### ${s.name}\` — not one of ${canon.join('/')}`);
				/* an empty section prints no header in the notes, so it is pure noise here */
				if (!s.bullets.length)
					fail(file, s.line, `[${v.id}] section \`### ${s.name}\` has no bullets`);
			}
			/* THE 0.9.2 FAULT: one section of each type per release. Two `### Fixed` under one version
			 * is a merge scar, and release-notes.sh reprints the header for each. */
			const dupes = names.filter((n, i) => names.indexOf(n) !== i);
			for (const d of new Set(dupes))
				fail(file, v.sections.find(s => s.name === d).line,
					`[${v.id}] duplicate section \`### ${d}\` — merge them into one`);

			const idx = names.filter(n => canon.includes(n)).map(n => canon.indexOf(n));
			if (idx.some((x, i) => i && x < idx[i - 1]))
				fail(file, v.line, `[${v.id}] sections are out of order: ${names.join(', ')}\n` +
					`         canon is ${canon.join(' -> ')} — reorder, do not follow commit chronology`);

			/* Every released version needs its compare link, and a link with no heading is stale. */
			if (v.id !== 'Unreleased' && !links.has(v.id))
				fail(file, v.line, `[${v.id}] has no \`[${v.id}]: …/compare/…\` link at the foot`);
		}

		const ids = new Set(versions.map(v => v.id));
		for (const [id, { line }] of links)
			if (!ids.has(id)) fail(file, line, `link \`[${id}]\` points at a version with no heading`);

		/* THE BOLD LEAD IS THE RELEASE NOTE, and a bullet without one is dropped from the release page
		 * in silence (release-notes.sh keeps only `**…**`). Checked on [Unreleased] and the newest
		 * version ONLY — those are the two that can still be published. 106 bullets in older sections
		 * predate the convention (it is unbroken from 0.8.4 up — 0.8.3 still has two); their notes are long since published,
		 * so demanding a rewrite would be a gate policing the past instead of the next release. */
		const publishable = versions.filter(v => v.id === 'Unreleased').concat(
			versions.filter(v => v.id !== 'Unreleased').slice(0, 1));
		for (const v of publishable)
			for (const s of v.sections)
				for (const b of s.bullets)
					if (!b.text.startsWith('- **'))
						fail(file, b.line, `[${v.id}] bullet has no **bold lead**, so the release page will ` +
							`drop it silently:\n         ${b.text.slice(0, 72)}…`);
	}

	/* THE MIRROR: same facts, only the prose language differs (docs/releasing.md). A mirror that lags is worse
	 * than none — the reader cannot tell which copy is stale — and nothing renders differently when it
	 * does, so only a comparison finds it. Sections are matched by CANONICAL INDEX, never by name. */
	const en = parse('CHANGELOG.md'), ru = parse('CHANGELOG_ru.md');
	const enIds = en.versions.map(v => v.id), ruIds = ru.versions.map(v => v.id);

	if (enIds.join() !== ruIds.join()) {
		const missing = enIds.filter(i => !ruIds.includes(i));
		const extra = ruIds.filter(i => !enIds.includes(i));
		fail('CHANGELOG_ru.md', 1,
			`the mirror's versions differ from CHANGELOG.md's` +
			(missing.length ? `\n         missing from the mirror: ${missing.join(', ')}` : '') +
			(extra.length ? `\n         only in the mirror: ${extra.join(', ')}` : '') +
			(!missing.length && !extra.length ? `\n         same set, different ORDER` : ''));
	} else {
		for (let i = 0; i < en.versions.length; i++) {
			const a = en.versions[i], b = ru.versions[i];
			if (a.rest.trim() !== b.rest.trim())
				fail('CHANGELOG_ru.md', b.line, `[${a.id}] date is "${b.rest.trim()}", CHANGELOG.md says "${a.rest.trim()}"`);

			const ia = a.sections.map(s => CANON['CHANGELOG.md'].indexOf(s.name));
			const ib = b.sections.map(s => CANON['CHANGELOG_ru.md'].indexOf(s.name));
			if (ia.join() !== ib.join()) {
				fail('CHANGELOG_ru.md', b.line,
					`[${a.id}] section set differs from CHANGELOG.md's\n` +
					`         en: ${a.sections.map(s => s.name).join(', ') || '(none)'}\n` +
					`         ru: ${b.sections.map(s => s.name).join(', ') || '(none)'}`);
				continue;
			}
			for (let j = 0; j < a.sections.length; j++)
				if (a.sections[j].bullets.length !== b.sections[j].bullets.length)
					fail('CHANGELOG_ru.md', b.sections[j].line,
						`[${a.id}] \`### ${b.sections[j].name}\` has ${b.sections[j].bullets.length} bullet(s), ` +
						`CHANGELOG.md's \`### ${a.sections[j].name}\` has ${a.sections[j].bullets.length} — ` +
						`the mirror is out of step`);
		}
	}

	const vcount = en.versions.length;

	// Printed only once the checks above are known to hold: this line used to run before the
	// `fails.length` check below and announced "mirror in lockstep, sections canonical" on its way to
	// exit 1, so a failing run's own first line of output contradicted its own exit code — a CI reader
	// skimming the top of the log read a pass.
	if (fails.length) {
		console.error('\nchangelog: FAILED\n');
		for (const f of fails) console.error(`  ${f}`);
		console.error('\nThe contract is docs/releasing.md. Both files are edited in one commit.');
		process.exit(1);
	}

	console.log(`changelog: ${vcount} version(s), mirror in lockstep, sections canonical`);
	console.log('changelog: the release notes will generate cleanly.');

}

if (isMain) {
	if (process.argv[2] !== 'add') gate();
	else try { addPair(process.argv.slice(3)); } catch (e) { console.error(`changelog: ${e.message}`); process.exit(1); }
}
