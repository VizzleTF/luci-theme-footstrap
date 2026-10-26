/* Small helpers several tools copied: a mkdir-p file write, a flag parser and the escaping of a
 * GitHub workflow command. */
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

/* GitHub workflow commands: a message's data and a property (title) escaped the way the runner reads
 * them, so text a stand or an app produced can neither end the line nor start a command of its own */
export const ghData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const ghProp = (s) => ghData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
