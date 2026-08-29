/* `innerHTML` and its two relatives, held by a rule instead of by review.
 *
 * The theme parses HTML from a string in four places and every one is safe today: three are `= ''`
 * clears and the fourth concatenates an icon builder with literals. Nothing checked that. The whole
 * chrome is built from `E()` and `document.createElement`, so a fifth site written the ordinary way
 * — `link.innerHTML = someLabel` — would be a script sink on a page fed by menu.d entries that any
 * package may ship, and it would read exactly like the four that are fine.
 *
 * eslint-plugin-no-unsanitized is the off-the-shelf answer and is not taken: it is a dependency in
 * a repository whose devDependencies are the argument for having a build at all, and its escape
 * hatch is a comment pragma rather than a named builder. This rule takes the same shape as the
 * codebase's other invariants — a small allowlist, stated once.
 *
 * SAFE is a string expression whose every leaf is a literal, a call to one of the two icon builders,
 * or a const bound to one of those. Anything else — a bare identifier, a property read, a template
 * with an interpolation, a function argument — fails and has to become `E()`/`textContent`, or be
 * added to BUILDERS with the reason it cannot carry attacker text.
 */

/* Two kinds of builder, and the difference is what happens to the argument.
 *
 * MARKUP takes markup and wraps it — svgIcon('<circle …/>') returns an <svg> around exactly what it
 * was handed — so its arguments are checked like any other operand.
 *
 * LOOKUP takes a NAME and returns markup the theme wrote: iconSvg()/iconFor() map a menu node's
 * name onto one of a closed set of paths, with a `|| ICONS._default` fallback, and never
 * interpolate the name into the result. Their arguments are unchecked on purpose — the name comes
 * from a menu.d entry any package may ship, and being unable to reach the output is the property
 * that makes the call safe. A builder added here must have that property. */
const MARKUP_BUILDERS = new Set([ 'svgIcon' ]);
const LOOKUP_BUILDERS = new Set([ 'iconSvg', 'iconFor' ]);

const SINK_PROPS = new Set([ 'innerHTML', 'outerHTML' ]);

function calleeName(node) {
	if (node.type === 'Identifier') return node.name;
	if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
		return node.property.name;
	return null;
}

export function makeRule() {
	return {
		meta: {
			type: 'problem',
			docs: { description: 'parse HTML from a string only out of literals and named builders' },
			schema: [],
			messages: {
				sink: 'HTML sink `{{ sink }}` fed a value this rule cannot prove is literal. Build the '
					+ 'node with E() or set textContent; if it is markup the theme owns, name its '
					+ 'builder in tools/lib/eslint-no-unsanitized.mjs.',
				banned: '`{{ sink }}` writes into the parser and has no safe form here.',
			},
		},
		create(context) {
			const src = context.sourceCode ?? context.getSourceCode();

			/* `seen` breaks the cycle a self-referential const would otherwise spin in */
			function safe(node, seen = new Set()) {
				if (!node || seen.has(node)) return false;
				seen.add(node);
				switch (node.type) {
				case 'Literal':
					return typeof node.value === 'string' || node.value === null;
				case 'TemplateLiteral':
					return node.expressions.every((e) => safe(e, seen));
				case 'BinaryExpression':
					return node.operator === '+' && safe(node.left, seen) && safe(node.right, seen);
				case 'ConditionalExpression':
					return safe(node.consequent, seen) && safe(node.alternate, seen);
				case 'LogicalExpression':
					return safe(node.left, seen) && safe(node.right, seen);
				case 'CallExpression': {
					const fn = calleeName(node.callee);
					if (LOOKUP_BUILDERS.has(fn)) return true;
					return MARKUP_BUILDERS.has(fn) && node.arguments.every((a) => safe(a, seen));
				}
				case 'Identifier': {
					/* a const whose single write is itself safe — the `chevron` shape. Walked up the
					 * scope chain by name: getScope(node) answers for the node's own scope, and the
					 * binding is usually one or more scopes above the sink. */
					let scope = src.getScope(node), v = null;
					while (scope && !v) {
						v = scope.variables.find((x) => x.name === node.name) ?? null;
						scope = scope.upper;
					}
					if (!v || v.defs.length !== 1) return false;
					const def = v.defs[0];
					if (def.type !== 'Variable' || def.parent.kind !== 'const') return false;
					if (v.references.some((r) => r.isWrite() && r.identifier !== def.name)) return false;
					return safe(def.node.init, seen);
				}
				default:
					return false;
				}
			}

			return {
				AssignmentExpression(node) {
					const left = node.left;
					if (left.type !== 'MemberExpression' || left.computed) return;
					if (left.property.type !== 'Identifier' || !SINK_PROPS.has(left.property.name)) return;
					if (safe(node.right)) return;
					context.report({ node, messageId: 'sink', data: { sink: left.property.name } });
				},
				CallExpression(node) {
					const name = calleeName(node.callee);
					if (name === 'insertAdjacentHTML') {
						if (safe(node.arguments[1])) return;
						context.report({ node, messageId: 'sink', data: { sink: name } });
					}
					/* document.write cannot be made safe on a page LuCI has already parsed: it
					 * reopens the document. There is no allowlist for it. */
					if ((name === 'write' || name === 'writeln')
						&& node.callee.type === 'MemberExpression'
						&& node.callee.object.type === 'Identifier'
						&& node.callee.object.name === 'document')
						context.report({ node, messageId: 'banned', data: { sink: `document.${name}` } });
				},
			};
		},
	};
}

export const plugin = { rules: { 'no-unsanitized-html': makeRule() } };
