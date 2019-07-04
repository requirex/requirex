import { features, origin } from './platform';

 /** Symbolic names for reUrlSimple match array members. */
 const enum UrlSimple {
	HREF = 0,
	PROTO,
	MAIN,
	QUERY,
	HASH
}

/** Symbolic names for reUrlFull match array members. */
const enum UrlFull {
	HREF = 0,
	PROTO,
	SLASHES,
	AUTH,
	HOSTNAME,
	PORT,
	PATH,
	QUERY,
	HASH
}

// PROTO.
const reProto = '^([0-9A-Za-z]+:)?';

/** Match a host, for use in reUrlFull. */
const reHost = (
	// SLASHES including host.
	'(' + (
		'//' +
		// AUTH.
		'([^@/?#]*@)?' +
		// HOSTNAME.
		'([^:/?#]*)' +
		// PORT or empty string.
		':?([0-9]*)'
	) + ')?'
);

const rePath = (
	// PATH (or MAIN if reHost is absent).
	'([^?#]*)' +
	// QUERY including ? or empty string.
	'(\\??[^#]*)' +
	// HASH including # or empty string.
	'(#?.*)$'
);

/** Match any string and split by the first : ? # chars.
  * Split by : only if a valid protocol name precedes it.
  * Most groups match an empty string to avoid testing for undefined later. */
const reUrlSimple = new RegExp(reProto + rePath);

/** Split a URL into parts relevant to url.parse(). */
const reUrlFull = new RegExp(reProto + reHost + rePath);

/** Match everything after the last directory component. */
const reFile = /(\/[^/?#]*)?([?#].*)?$/;

/** Prototypes known to include a path component, to be added if missing. */
const knownProto: { [proto: string]: 1 } = { 'file:': 1, 'http:': 1, 'https:': 1 };

/** Skip given number of slashes in a path starting from a given offset. */

export function skipSlashes(key: string, start: number, count: number) {
	while((start = key.indexOf('/', start) + 1) && --count);

	return start;
}

/** Strip query string, hash, last slash in path and anything after it
  * to get the directory part of a path or address. **/

export function getDir(key: string) {
	return key.replace(reFile, '');
}

export class URL {

	static parse(key: string) {
		const parts = key.match(reUrlFull)!;

		// All fields are coerced to (possibly empty) strings.
		let _: string | null = '';

		let auth = parts[UrlFull.AUTH] || _;
		auth = auth.substr(0, auth.length - 1);

		const protocol = parts[UrlFull.PROTO] || _;
		const slashes = parts[UrlFull.SLASHES] || _;
		const hostname = parts[UrlFull.HOSTNAME] || _;
		const port = parts[UrlFull.PORT] || _;
		const host = hostname + (port && ':') + port;
		const pathname = parts[UrlFull.PATH] || (host && '/');
		const search = parts[UrlFull.QUERY];
		const path = pathname + search;
		const query = search.substr(1);
		const hash = parts[UrlFull.HASH];

		const href = protocol + (slashes && '//') + auth + (auth && '@') + host + path + hash;

		// Replace empty strings with null in all result fields except href.
		_ = null;

		return {
			protocol: protocol || _,
			slashes: !!slashes || _,
			auth: auth || _,
			host: host || _,
			port: port || _,
			hostname: hostname || _,
			hash: hash || _,
			search: search || _,
			query: query || _,
			pathname: pathname || _,
			path: path || _,
			href
		};
	}

	/** Resolve a relative address. */

	static resolve(base: string, key: string) {
		// Parse base and relative addresses.
		const baseParts = base.match(reUrlSimple)!;
		const keyParts = key.match(reUrlSimple)!;

		// Extract protocol, preferentially from the relative address.
		let proto = keyParts[UrlSimple.PROTO] || baseParts[UrlSimple.PROTO] || '';
		base = baseParts[UrlSimple.MAIN];
		key = keyParts[UrlSimple.MAIN];

		if(!key) {
			// Key with no server / path only replaces the query string and/or hash.
			return (
				proto +
				baseParts[UrlSimple.MAIN] +
				(keyParts[UrlSimple.QUERY] || baseParts[UrlSimple.QUERY]) +
				keyParts[UrlSimple.HASH]
			);
		}

		const suffix = keyParts[UrlSimple.QUERY] + keyParts[UrlSimple.HASH];
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
		} else if(
			keyParts[UrlSimple.PROTO] &&
			!knownProto[keyParts[UrlSimple.PROTO]] &&
			key.charAt(0) != '.'
		) {
			// Weird protocols followed by neither explicitly absolute nor
			// relative paths are used as-is, ignoring the base path.
			return keyParts[UrlSimple.PROTO] + key + suffix;
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

		return proto + base + suffix;
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
			pos = next;
		}

		return pos;
	}

	static relative(base: string, key: string) {
		const start = URL.common(base, key);
		const pathOffset = skipSlashes(base, 0, 3);

		if(!pathOffset || pathOffset > start) return key;

		let pos = start;
		let next: number;
		let prefix = '';

		while((next = base.indexOf('/', pos) + 1)) {
			prefix += '../';
			pos = next;
		}

		return prefix + key.substr(start);
	}

	static fromLocal(local: string) {
		let key = local;

		if(features.isWin) {
			// TODO: Convert \\server\ to file://server/
			key = key.replace(/\\/g, '/').replace(/^([0-9A-Za-z]+:\/)/, '/$1');
		}

		return key.replace(/^\//, 'file:///');
	}

	/** Convert URL to a local path. Strip protocol and possible origin,
	  * use backslahes in file system paths on Windows. */

	static toLocal(key: string) {
		if(key.match(/^file:/)) {
			key = key.replace(/^file:\/\//, '');
		} else if(origin && key.substr(0, origin.length) == origin) {
			key = key.substr(origin.length);
		}

		if(features.isWin) {
			// TODO: Convert file://server/ to \\server\
			key = key.replace(/^\/([0-9A-Za-z]+:\/)/, '$1').replace(/\//g, '\\');
		}

		return key;
	}

}
