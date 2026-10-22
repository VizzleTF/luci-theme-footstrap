/* The shared scratch directory ../tmp of the MAIN checkout, from any linked worktree too.
 *
 * `join(ROOT, '..', 'tmp')` from a worktree is a second ../tmp (.claude/worktrees/tmp, ../tmp/tmp),
 * so the stand locks of a worktree and of the main tree were different files and two runs could
 * drive one stand. The common git dir is the main checkout's .git from every worktree; outside git
 * (an archive, a copy) the answer is `<root>/../tmp` as before. tools/lib/tmp-root.sh is the same
 * rule for sh. */
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { ROOT } from './root.mjs';

export function tmpRoot(root = ROOT) {
	let main = root;
	try {
		const g = execFileSync('git', [ '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir' ],
			{ encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }).trim();
		if (basename(g) === '.git') main = dirname(g);
	} catch { /* not a git checkout, or no git: the checkout's own parent */ }
	return resolve(main, '..', 'tmp');
}
