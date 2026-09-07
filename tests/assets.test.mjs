/* `_sanitizeSvg` (fs-assets.js), issue 0157: the uploaded-pattern path now CLEANS an SVG instead of
 * refusing it — the elements and attributes `_svgObjection` used to refuse the whole file over are
 * now removed one at a time, and only four things stay an outright refusal: not an SVG, a parser
 * error, the wrong namespace, or nothing left once the unsafe parts are gone. This is NOT the
 * security boundary (root/www/cgi-bin/luci-theme-footstrap-pattern's CSP header is); it exists so an
 * admin whose export carries an editor artefact gets a working tile and a note, not a refusal.
 *
 * `_sanitizeSvg` needs a `DOMParser` and an `XMLSerializer`, which Node ships neither of. What
 * follows is NOT a browser's XML engine: it is a small tree built from a regex-flat tokenizer, wide
 * enough to answer the questions `_sanitizeSvg` actually asks — tag/attribute names and values,
 * nesting one level deep or many, element removal, attribute removal, and a serializer that can
 * write the tree back out. Entities and text nodes are still not modelled, but element namespaces
 * ARE (security review finding, LOW): every `xmlns`/`xmlns:prefix` an element carries is tracked and
 * inherited down the tree the way Namespaces in XML §5.3 resolves one, `xml:` bound to its reserved
 * URI with no declaration needed (§4), so a fixture can put an element in a namespace its own tag
 * text does not name — the only way to prove `localName`-based removal is genuinely
 * namespace-oblivious, and the only way to write a root whose SPELLING is `svg` but whose NAMESPACE
 * is not. So this proves the FUNCTION's decisions — which tag or attribute is removed, which
 * declaration inside a `style` survives, when the original bytes come back untouched, which
 * namespace an element resolves to — and not that a real engine tokenises `url(`/CSS escapes the
 * same way; that half is the comment's own citations in fs-assets.js (measured executing on …), not
 * this file's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/* ---- the fake tree: just enough of Element/ProcessingInstruction/Document to sanitize ---- */

const TAG_TOKEN_RE = /<\?([^>]*)\?>|<!--[\s\S]*?-->|<\/([A-Za-z_:][-\w:.]*)\s*>|<([A-Za-z_:][-\w:.]*)([^<>]*?)\/>|<([A-Za-z_:][-\w:.]*)([^<>]*)>/g;
const ATTR_RE = /([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(blob) {
	const attrs = [];
	ATTR_RE.lastIndex = 0;
	let am;
	while ((am = ATTR_RE.exec(blob)) !== null)
		attrs.push({ name: am[1], value: am[2] !== undefined ? am[2] : am[3] });
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
	get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
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
	let m;
	while ((m = TAG_TOKEN_RE.exec(text)) !== null) {
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
	return el.attributes.map((a) => ' ' + a.name + '="' + String(a.value).replace(/"/g, '&quot;') + '"').join('');
}
function serializeNode(n) {
	if (n.nodeType === 7) return '<?' + n.data + '?>';
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

test('an unprefixed script re-namespaced to xhtml is still removed — the check is namespace-oblivious', () => {
	/* The child's own `xmlns` overrides the root's default, so this element genuinely resolves to the
	 * xhtml namespace rather than inheriting SVG_NS — proving `_sanitizeSvg` removes it on `localName`
	 * alone, the same as it would in a real engine, and not because the fake happened to agree. */
	const result = sanitize(svg('<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script><path d="M0 0"/>'));
	assert.equal(result.error, undefined);
	assert.equal(result.elements, 1);
	assert.ok(!(/alert/i).test(result.text));
});

test('xml:base on a non-root element is removed, closing the relative href it would redirect off-router — LOW finding', () => {
	/* No scheme, no leading `//` — the href-off-router check below has nothing to catch here, because
	 * the base moved instead of the reference. Nested under a non-root element on purpose: the check
	 * has to walk the whole tree, not just the root, to close this. */
	const result = sanitize(svg('<g xml:base="http://evil.example/"><image href="x.png"/></g>'));
	assert.equal(result.error, undefined);
	assert.equal(result.refs, 1);
	assert.ok(!(/evil\.example/).test(result.text));
	assert.ok((/href="x\.png"/).test(result.text));
});
