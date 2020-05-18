/** Type or promise for a type.
  * Returning this is rumored to release Zalgo. */
export type Zalgo<T> = T | Promise<T>;

export const emptyPromise = Promise.resolve(void 0);

/** Array.prototype.slice for turning array-like objects into arrays. */
export const slice = [].slice;

export const stringify = JSON.stringify;

export function indexOf<Type>(needle: Type, haystack: Type[]) {
	const count = haystack.length;

	for(let num = 0; num < count; ++num) {
		if(haystack[num] == needle) return num;
	}

	return -1;
}

/** Object.prototype.hasOwnProperty, to safely handle objects with strange
  * or missing prototypes. For example:
  *
  * hasOwn.call(Object.create(null), 'key') */
export const hasOwn = {}.hasOwnProperty;

/** Object.keys polyfill. */
export const keys = Object.keys || ((obj: { [key: string]: any }) => {
	const result: string[] = [];

	for(let key in obj) {
		if(hasOwn.call(obj, key)) result.push(key);
	}

	return result;
});

/** Object.assign polyfill with deep recursion.
  * Assign all members from src to dst object.
  *
  * @param dst Target object receiving new members.
  * @param src Source object to copy from. Prototype contents are ignored.
  * @param depth Recursion depth for nested objects.
  * 0 for no recursion (default), < 0 for unlimited depth
  * (latter will hang on circular structures).
  *
  * @return dst object. */

export function assign(
	dst: { [key: string]: any },
	src: { [key: string]: any },
	depth?: number
) {
	for(let name of keys(src)) {
		let value = src[name];

		if(depth && typeof value == 'object' && !(value instanceof Array)) {
			value = assign(dst[name] || (dst[name] = {}), value, depth - 1);
		} else {
			dst[name] = value;
		}
	}

	return dst;
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

	return orig;
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

/** Match everything after the last directory component. */
const reFile = /(\/[^/?#]*)?([?#].*)?$/;

/** Strip query string, hash, last slash in path and anything after it
  * to get the directory part of a path or address. **/

export function getDir(key: string) {
	return key.replace(reFile, '');
}

/** Strip final slash character from input path, unless it's the only character. */

export function stripSlash(key: string) {
	return key.replace(/([^/])\/$/, '$1');
}

/** Append a slash to input path, unless it already ends with a slash. */

export function appendSlash(key: string) {
	return key.replace(/([^/]|^)$/, '$1/');
}

/** Clone an object without invoking getters, by subclassing it.
  * Allows setting custom properties on internal objects. */

export function subClone<Type extends Object>(obj: Type): Type {
	function Child() { }
	Child.prototype = obj;

	return new (Child as any)();
}
