/* Small helpers several gates copied: a timestamped line logger and a mkdir-p file write. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

/* One newline-terminated line per call with seconds since this call of makeSay, so a runner flushes
 * it live and a run cancelled at the 45-minute cap names the page it died on. */
export function makeSay() {
	const T0 = Date.now();
	return (line) => process.stdout.write(`${String(Math.round((Date.now() - T0) / 1000)).padStart(4)}s  ${line}\n`);
}

export function writeFile(path, body) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
}

/* Every gate parses its flags here so an unknown or malformed one is a usage error (exit 2, one
 * line) and never a Node stack trace. */
export function parseFlags(gate, options) {
	try { return parseArgs({ options }).values; }
	catch (e) {
		console.error(`${gate}: ${e.message}`);
		process.exit(2);
	}
}
