import * as VM from 'vm';

import { FetchOptions, FetchResponse } from './fetch';

declare const __global__: typeof globalThis;
declare const process: any;

function tryGlobal(obj: any, name: string) {
	return obj[name] == obj && obj;
}

// See https://mathiasbynens.be/notes/globalthis

function getGlobal() {
	const proto: any = Object.prototype;
	const magic = '__global__';

	try {
		Object.defineProperty(proto, magic, {
			get: function() { return this; },
			configurable: true
		});

		return __global__;
	} finally {
		delete proto[magic];
	}
}

const object = 'object';
export const globalEnv: { [name: string]: any } = (
	(typeof globalThis == object && tryGlobal(globalThis, 'globalThis')) ||
	getGlobal() ||
	(typeof self == object && tryGlobal(self, 'self')) ||
	(typeof window == object && tryGlobal(window, 'window')) ||
	(typeof global == object && tryGlobal(global, 'global'))
);

export const unsupported = 'Unsupported function ';
export const emptyPromise = Promise.resolve(void 0);

const isNode = (
	typeof process == 'object' &&
	({}).toString.call(process) == '[object process]'
);

let isES6: boolean;

try {
	isES6 = (0, eval)('(...a)=>({a}={a:`${a[0]}`})')('x').a == 'x';
} catch(err) {
	isES6 = false;
}

export const features = {
	fetch: (key: string, options?: FetchOptions): Promise<FetchResponse> => {
		throw(new Error(unsupported + 'fetch'));
	},
	isES6,
	isNode,
	isWin: (
		isNode &&
		typeof process.platform == 'string' &&
		process.platform.substr(0, 3) == 'win'
	)
};

const _getTags = typeof document == 'object' && document.getElementsByTagName;
export const getTags = _getTags && ((name: string) => _getTags.call(document, name));

/** Portable replacement for location.origin. */
export const origin = (typeof window == 'object' &&
	typeof location == 'object' &&
	location == window.location ? (
		location.protocol + '//' +
		location.hostname +
		(location.port ? ':' + location.port : '')
	) : ''
);

export function keys(obj: { [key: string]: any }) {
	const result: string[] = [];

	for(let key in obj) {
		// Object.create(null) produces objects with no built-in methods.
		if(Object.prototype.hasOwnProperty.call(obj, key)) {
			result.push(key);
		}
	}

	return result;
}

/** Assign all members from src to dst object.
  *
  * @param depth Recursion depth for nested objects.
  * 0 for no recursion (default), < 0 for unlimited depth
  * (latter will hang on circular structures).
  * @return dst object. */

export function assign(
	dst: { [key: string]: any },
	src: { [key: string]: any },
	depth?: number
) {
	for(let name of keys(src)) {
		let value = src[name];

		if(depth && typeof value == 'object' && !(value instanceof Array)) {
			value = assign(dst[name] || {}, value, depth - 1);
		}

		dst[name] = value;
	}

	return(dst);
}

/** Assign all members from src to dst object and return their previous values.
  * Assign them back to dst to restore it back to original
  * (note: previously missing keys will not be deleted but set to undefined).
  *
  * @return Object with field names from src and values from dst
  * before the assignment. */

export function assignReversible(
	dst: { [key: string]: any },
	src: { [key: string]: any }
) {
	const orig: { [key: string]: any } = {};

	for(let name of keys(src)) {
		orig[name] = dst[name];
		dst[name] = src[name];
	}

	return(orig);
}

/** Split input string into keys and create a table mapping each key to true.
  *
  * @param sep Optional separator to use in splitting, default is space.
  * An empty separator uses each character in the input string as a key. */

export function makeTable(items: string, sep = ' ') {
	const result: { [key: string]: boolean } = {};

	for(let key of items.split(sep)) {
		result[key] = true;
	}

	return result;
}

const nodeRegistry: { [name: string]: any } = {};
const req = typeof require == 'function' && require;

export function nodeRequire(name: string) {
	return nodeRegistry[name] || (
		nodeRegistry[name] = req ? req(name) : {}
	);
}

/** Evaluate source code in the global scope. */

export function globalEval(code: string): () => any {
	if(isNode) {
		const vm: typeof VM = nodeRequire('vm');
		return vm.runInThisContext(code);
	} else {
		// Indirect eval runs in global scope.
		return (0, eval)(code);
	}
}
