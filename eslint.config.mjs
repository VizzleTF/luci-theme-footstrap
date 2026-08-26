import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import { readFileSync, readdirSync } from 'node:fs';
import { utProcessor } from './tools/lib/ut-scripts.mjs';

/* ESLint for the theme's browser JS. Runs in CI and locally, never on the OpenWrt buildbot: it has
 * no node and needs none — luci.mk copies htdocs/ verbatim.
 *
 * `globalReturn` is the non-obvious bit. A LuCI resource file is neither a script nor an ES module:
 * luci.js evaluates its body inside a function wrapper, which is why every one of these files ends
 * in a bare `return baseclass.extend({...})`. A stock parser rejects a top-level `return`, so
 * without it the whole tree fails to parse and the lint is worthless.
 */

/* Every resource module, with the alias each one binds via a `'require <mod> as <alias>'` pragma.
 * `'require ui'` with no alias binds the bare name and is a global below; only the aliased form
 * needs deriving. The config entry at the bottom says why this is read from the source.
 */
const HTDOCS_GLOBS = [
	'luci-theme-footstrap/htdocs/**/*.js',
];
const RESOURCE_DIRS = [
	'luci-theme-footstrap/htdocs/luci-static/resources',
];
function resourceFiles() {
	return RESOURCE_DIRS.flatMap((dir) => readdirSync(dir, { recursive: true })
		.filter((f) => f.endsWith('.js'))
		.map((f) => {
			const file = `${dir}/${f}`.replace(/\\/g, '/');
			const src = readFileSync(file, 'utf8');
			const aliases = [...src.matchAll(/^'require\s+\S+\s+as\s+(\w+)'/gm)].map((m) => m[1]);
			return { file, aliases };
		}))
		.filter((e) => e.aliases.length);
}

export default [
	/* eslint:recommended as the floor. The hand-picked list below used to be the whole config, which
	 * quietly left every other free correctness rule off (no-dupe-keys, no-unreachable, getter-return,
	 * ~30 more — each a bug that compiles, none a style opinion). Turning the set on found zero new
	 * violations. The rules below are the ones recommended does not give you. */
	{ files: HTDOCS_GLOBS, ...js.configs.recommended },
	{
		files: HTDOCS_GLOBS,
		plugins: { '@stylistic': stylistic },
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'script',
			parserOptions: {
				ecmaFeatures: { globalReturn: true },
			},
			globals: {
				...globals.browser,
				/* injected by luci.js into every resource file's scope */
				L: 'readonly',
				E: 'readonly',
				_: 'readonly',
				baseclass: 'readonly',
				ui: 'readonly',
				/* the base class every LuCI view extends, bound by a bare `'require view'`. The theme
				 * ships no view of its own, so this is here for a module that composes with one. */
				view: 'readonly',
				dom: 'readonly',
				fs: 'readonly',
				uci: 'readonly',
				rpc: 'readonly',
				form: 'readonly',
				network: 'readonly',
				poll: 'readonly',
				request: 'readonly',
				validation: 'readonly',
			},
		},
		rules: {
			/* An empty `catch {}` is the deliberate idiom: every localStorage access is wrapped in one,
			 * because a browser in private mode throws on getItem and a preference that cannot be read
			 * is a default, not an error. Empty blocks anywhere else stay an error. */
			'no-empty': ['error', { allowEmptyCatch: true }],

			/* correctness — these are the ones that catch real bugs */
			'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
			'no-undef': 'error',
			'no-implicit-globals': 'error',
			'no-shadow': 'warn',
			'no-var': 'error',
			'prefer-const': 'warn',
			/* `always`, not `smart`. Both allow the deliberate `x != null` idiom (hence null: 'ignore'),
			 * but `smart` also waves through `typeof x == 'function'` — the one this codebase had drifted
			 * on, 5 loose sites against 9 strict. Loose == on a typeof is never wrong, which is why it
			 * spreads unnoticed. */
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-return-await': 'warn',
			'no-unsafe-optional-chaining': 'error',
			'no-constant-binary-expression': 'error',
			'no-self-compare': 'error',
			'no-template-curly-in-string': 'warn',
			'require-atomic-updates': 'warn',

			/* the theme's own house rules, from docs/conventions.md */
			'no-alert': 'error',
			'no-console': ['warn', { allow: ['warn', 'error'] }],

			/* jsmin safety — correctness, not style. luci.mk minifies this file with jsmin, whose
			 * regex-vs-division test is a one-character lookback against a fixed allow-list: `n` (last
			 * letter of `return`) and `>` (from `=>`) are not on it, `(` is. So a regex literal straight
			 * after `return` or `=>` is read as a division, and if its body contains `//` jsmin swallows
			 * the rest of the file, exiting 0 while doing it (openwrt/luci#8299).
			 *
			 * `wrap-regex` forces `(/re/).test(x)`, putting a `(` in front of every regex that is the
			 * object of a member expression — exactly the hazardous shape. A regex passed as an argument
			 * already sits behind `(` or `,` and is not flagged. tools/jsmin-verify.mjs is the backstop;
			 * this rule stops the breakage being written. */
			'wrap-regex': 'error',

			/* The two formatting rules are @stylistic/* because ESLint deprecated formatting rules in
			 * core (8.53). Both close a measured drift: arrow-parens stood at 62 with against 21 without,
			 * mixed inside single files, and no-mixed-operators covers `e && e.message || e`, correct by
			 * precedence and unreadable by design. Neither can change behaviour; both are autofixable. */
			'@stylistic/arrow-parens': ['error', 'always'],
			'@stylistic/no-mixed-operators': 'error',
		},
	},
	/* `'require fs-prefs as prefs';` — the same pragma mechanism as `ui`/`baseclass` above: luci.js
	 * resolves the module and passes it into this file's factory as a formal parameter, so the alias
	 * is a real binding at runtime with no declaration ESLint could see. Without a global it is a
	 * `no-undef` error in every file that composes with another module.
	 *
	 * Derived from the pragmas, not listed, so each file gets exactly the aliases it requires. A
	 * hand-written per-file list stops covering the next module somebody adds; declaring every alias
	 * tree-wide switches off the `no-undef` that catches a file using `prefs.` without requiring it.
	 */
	...resourceFiles().map(({ file, aliases }) => ({
		files: [ file ],
		languageOptions: { globals: Object.fromEntries(aliases.map((a) => [ a, 'readonly' ])) },
	})),

	/* The templates' inline <script>s — the theme's other browser JS, and until this entry unchecked
	 * by anything: eslint walked htdocs/ and jsmin minifies that same tree, while a .ut is copied to
	 * the router verbatim. Both looked straight past the pre-paint in partials/head.ut, whose only
	 * failure symptom is one wrong frame that nobody reports. tools/lib/ut-scripts.mjs pulls each
	 * non-interpolated <script> body out as a virtual `<n>.js`, padded so line/column point back at
	 * the .ut; see there for why an interpolated block is exempt. */
	{ files: [ '**/*.ut' ], processor: utProcessor },
	{ files: [ '**/*.ut/*.js' ], ...js.configs.recommended },
	{
		files: [ '**/*.ut/*.js' ],
		plugins: { '@stylistic': stylistic },
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'script',
			globals: {
				...globals.browser,
				L: 'readonly',
				/* the pre-paint's channel for server values: head.ut and sysauth.ut each emit one
				 * interpolated data blob (see ut-scripts.mjs) that the linted blocks read. */
				__fsSD: 'readonly',
				__fsHttps: 'readonly',
			},
		},
		rules: {
			/* same reason as htdocs: every localStorage read is wrapped in an empty catch, because a
			 * browser in private mode throws and an unreadable preference is a default. */
			'no-empty': [ 'error', { allowEmptyCatch: true } ],
			'no-unused-vars': [ 'error', { args: 'none', caughtErrors: 'none' } ],
			'no-undef': 'error',
			'no-shadow': 'warn',
			'no-var': 'error',
			'prefer-const': 'warn',
			eqeqeq: [ 'error', 'always', { null: 'ignore' } ],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-new-func': 'error',
			'no-constant-binary-expression': 'error',
			'no-self-compare': 'error',
			'no-alert': 'error',
			'no-console': [ 'warn', { allow: [ 'warn', 'error' ] } ],
			/* Same as htdocs, and they matter more here: this is the pre-paint, the one copy of every
			 * axis that runs before the module loader exists. Zero violations today. */
			'@stylistic/arrow-parens': [ 'error', 'always' ],
			'@stylistic/no-mixed-operators': 'error',
			/* No `wrap-regex` and no `no-implicit-globals` here. jsmin never sees a template — luci.mk
			 * copies ucode/ verbatim — so the regex-vs-division hazard cannot arise; and these blocks are
			 * IIFEs in real global scope, where a top-level declaration is the point. */
		},
	},
];
