import { isWin } from './platform';

/** Match any string and split by the first : ? # chars.
  * Split by : only if a valid protocol name precedes it.
  * Most groups match an empty string to avoid testing for undefined later. */
const reUrl = /^([0-9A-Za-z]+:)?([^?#]*)(\??[^#]*)(#?.*)$/;

const knownProto: { [proto: string]: 1 } = { 'file:': 1, 'http:': 1, 'https:': 1 };

/** Skip given number of slashes in a path starting from a given offset. */

export function skipSlashes(key: string, start: number, count: number) {
	while((start = key.indexOf('/', start) + 1) && --count);

	return(start);
}

export class URL {

	/** Resolve a relative address. */

	static resolve(base: string, key: string) {
		// Parse base and relative addresses.
		const baseParts = base.match(reUrl)!;
		const keyParts = key.match(reUrl)!;

		// Extract protocol, preferentially from the relative address.
		let proto = keyParts[1] || baseParts[1] || '';
		base = baseParts[2];
		key = keyParts[2];

		if(!key) {
			// Key with no server / path only replaces the query string and/or hash.
			return(proto + baseParts[2] + (keyParts[3] || baseParts[3]) + keyParts[4]);
		}

		const suffix = keyParts[3] + keyParts[4];
		const hasServer = base.substr(0, 2) == '//';
		let pos = 0;

		// Handle an absolute key.
		if(key.charAt(0) == '/') {
			if(!hasServer) {
				// If the base address has no server name, clear everything.
				base = '';
			} else if(key.charAt(1) == '/') {
				// Two leading slashes remove everything after the protocol.
				base = '//';
				pos = 2;
			} else {
				// One leading slash removes everything after the server name.
				const root = base.indexOf('/', 2) + 1;
				if(root) base = base.substr(0, root);
				pos = 1;
			}
		} else if(keyParts[1] && !knownProto[keyParts[1]] && key.charAt(0) != '.') {
			// Weird protocols followed by neither explicitly absolute nor
			// relative paths are used as-is, ignoring the base path.
			return(keyParts[1] + key + suffix);
		}

		let slash = base.lastIndexOf('/') + 1;

		// Remove file (but not server) name from the base address.
		// Ensure it has a final slash.
		if(!hasServer || slash > 2) {
			base = base.substr(0, slash);
		} else if(base != '//') {
			base += '/';
		}

		// Handle relative path.
		while(pos <= key.length) {
			// Get next relative address part between slashes.
			const next = key.indexOf('/', pos) + 1 || key.length + 1;
			const part = key.substr(pos, next - pos - 1);
			pos = next;

			if(part == '.' || part == '..') {
				slash = base.lastIndexOf('/', base.length - part.length) + 1;
				if(!hasServer || slash > 2) base = base.substr(0, slash);
			} else {
				base += part;
				if(pos <= key.length) base += '/';
			}
		}

		// Ensure server names have a final slash.
		if(knownProto[proto] && hasServer && base.lastIndexOf('/') < 2) base += '/';

		return(proto + base + suffix);
	}

	static common(a: string, b: string) {
		let pos = 0;
		let next: number;

		a = a.replace(/[#?].*/, '');
		b = b.replace(/[#?].*/, '');

		while(
			(next = a.indexOf('/', pos) + 1) &&
			a.substr(pos, next - pos) == b.substr(pos, next - pos)
		) {
			// console.log(a.substr(pos, next - pos), b.substr(pos, next - pos));
			pos = next;
		}

		return(pos);
	}

	static relative(base: string, key: string) {
		const start = URL.common(base, key);
		const pathOffset = skipSlashes(base, 0, 3);

		if(!pathOffset || pathOffset > start) return(key);

		let pos = start;
		let next: number;
		let prefix = '';

		while((next = base.indexOf('/', pos) + 1)) {
			prefix += '../';
			pos = next;
		}

		return(prefix + key.substr(start));
	}

	static fromLocal(local: string) {
		let key = local;

		if(isWin) {
			// TODO: Convert \\server\ to file://server/
			key = key.replace(/\\/g, '/').replace(/^([0-9A-Za-z]+:\/)/, '/$1');
		}

		return(key.replace(/^\//, 'file:///'));
	}

	static toLocal(key: string) {
		let local = key.replace(/^file:\/\//, '');

		if(isWin) {
			// TODO: Convert file://server/ to \\server\
			local = local.replace(/^\/([0-9A-Za-z]+:\/)/, '$1').replace(/\//g, '\\');
		}

		return(local);
	}

}
