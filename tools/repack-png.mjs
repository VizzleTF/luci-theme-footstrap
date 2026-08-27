#!/usr/bin/env node
/* Repack the shipped PNGs' pixel stream with a harder deflate.
 *
 * The icons come out of `tools/build-icons.mjs`, which rasterises them in a headless Chromium, and
 * Chromium encodes for speed: the app icon's IDAT is 4,529 B where the same pixels re-deflated at
 * level 9 with Z_FILTERED are 3,948. No oxipng in this repo's tool set and none in CI's image, so
 * this does the one part of what oxipng does that needs no image decoder — the pixels, the filter
 * bytes and the palette are untouched, only the compressed container is rebuilt.
 *
 * Over a BUILD TREE, never the checkout: `build-icons.mjs` would overwrite a repacked file on its
 * next run, and the checked-in PNG is the one a reviewer diffs. Same trade as minify-js.mjs — an
 * SDK build has no node and ships the file as it is.
 *
 * Usage: node tools/repack-png.mjs <dir> */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const dir = process.argv[2];
if (!dir) {
	console.error('usage: repack-png.mjs <dir>');
	process.exit(2);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
	return c >>> 0;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([ head.subarray(4), data ])), 0);
	return Buffer.concat([ head, data, crc ]);
}

const pngs = readdirSync(dir, { recursive: true, encoding: 'utf8' })
	.filter((f) => f.endsWith('.png')).map((f) => join(dir, f)).sort();

let files = 0, before = 0, after = 0;
for (const file of pngs) {
	const buf = readFileSync(file);
	/* the 8-byte signature, then type-length-value chunks; IDAT may be split across several and the
	 * pieces are one zlib stream, not one per chunk */
	const out = [ buf.subarray(0, 8) ];
	const idat = [];
	let off = 8, ok = true;
	while (off + 8 <= buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString('ascii', off + 4, off + 8);
		if (off + 12 + len > buf.length) { ok = false; break; }
		if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
		else out.push(buf.subarray(off, off + 12 + len));
		off += 12 + len;
	}
	if (!ok || !idat.length) {
		console.error(`repack-png: ${file} is not a PNG this tool understands — left alone`);
		continue;
	}

	const raw = inflateSync(Buffer.concat(idat));
	let best = null;
	/* Z_FILTERED wins on the palette icon and Z_DEFAULT on other shapes; the loop costs
	 * milliseconds on files this size and removes the guess */
	for (const strategy of [ 0, 1, 2, 3, 4 ]) {
		const packed = deflateSync(raw, { level: 9, memLevel: 9, strategy });
		if (!best || packed.length < best.length) best = packed;
	}
	/* the pixels must survive the round trip byte for byte — this rewrites a container, not an
	 * image, and a mismatch means it did something else */
	if (!inflateSync(best).equals(raw)) {
		console.error(`repack-png: ${file} did not round-trip — refusing`);
		process.exit(1);
	}

	/* IEND must stay last: the new IDAT goes in front of it, where the old ones were */
	const tail = out.pop();
	const rebuilt = Buffer.concat([ ...out, chunk('IDAT', best), tail ]);
	if (rebuilt.length >= buf.length) continue;	/* already tighter than we can pack it */
	writeFileSync(file, rebuilt);
	before += buf.length;
	after += rebuilt.length;
	files++;
}

if (!files) {
	console.log('repack-png: nothing to gain, every PNG left as it was');
	process.exit(0);
}
console.log(`repack-png: ${files} file(s), ${before} -> ${after} B (-${before - after})`);
