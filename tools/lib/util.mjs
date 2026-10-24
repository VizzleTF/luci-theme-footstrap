/* Small helpers several tools copied: a mkdir-p file write and a flag parser. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

export function writeFile(path, body) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
}

/* A tool parses its flags here so an unknown or malformed one is a usage error (exit 2, one
 * line) and never a Node stack trace. */
export function parseFlags(tool, options) {
	try { return parseArgs({ options }).values; }
	catch (e) {
		console.error(`${tool}: ${e.message}`);
		process.exit(2);
	}
}
