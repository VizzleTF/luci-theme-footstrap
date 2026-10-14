/* The share of a JS file's bytes that is comment text, the delimiters included. One definition for
 * the gate (tools/comment-share.mjs) and its test. The parse is acorn's, so a `//` or a quote inside a
 * string or a regex literal is not mistaken for a comment. */
import * as acorn from 'acorn';

/* -> { comment, total } in bytes. `allowReturnOutsideFunction`: a LuCI resource file ends in a bare
 * `return baseclass.extend({...})` because luci.js evaluates it inside a function wrapper. */
export function commentBytes(src) {
	let comment = 0;
	acorn.parse(src, {
		ecmaVersion: 2023,
		allowReturnOutsideFunction: true,
		onComment: (_block, _text, start, end) => { comment += Buffer.byteLength(src.slice(start, end)); },
	});
	return { comment, total: Buffer.byteLength(src) };
}
