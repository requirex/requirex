/** Test if global variable obj represents the global environment.
  * It should contain itself as a member with name matching the global
  * variable name.
  *
  * @param obj Global variable to test.
  * @param name Name of the global variable.
  * @return obj if it's the global environment, false otherwise. */

function tryGlobalEnv(obj: any, name: string): typeof globalThis {
	return obj[name] == obj && obj;
}

/** Get the global "this" object without relying on any existing global
  * variable or eval. We don't know what it is, but it should inherit Object.
  * So we add a specially named getter on Object.prototype returning "this"
  * and read a global variable with the same name, to call the getter.
  *
  * See https://mathiasbynens.be/notes/globalthis
  *
  * @return The global environment / this object. */

function getGlobal(): typeof globalThis & { [name: string]: any } {
	const proto: any = Object.prototype;
	const magic = '__global__';

	try {
		Object.defineProperty(proto, magic, {
			get: function() { return this; },
			configurable: true
		});

		return __global__;
	} catch(err) {
		// If the trick fails, try some common global variables instead.
		const object = 'object';

		return (
			// The latest standard way to get the environment.
			(typeof globalThis == object && tryGlobalEnv(globalThis, 'globalThis')) ||
			// "self" is the global object in browsers, including inside workers.
			(typeof self == object && tryGlobalEnv(self, 'self')) ||
			// "window" works in absolutely all browsers, but not inside workers.
			(typeof window == object && tryGlobalEnv(window, 'window')) ||
			// "global" works in Node.js.
			(typeof global == object && tryGlobalEnv(global, 'global')) ||
			{} as any
		);
	} finally {
		// Remove the special global variable after returning its contents.
		delete proto[magic];
	}
}

/** Magic global variable created and deleted in getGlobal(). */
declare const __global__: typeof globalThis;

/** The global environment / this object. */
export const globalEnv = getGlobal();

/** Evaluate source code in the global scope.
  * Calling code should append a sourceURL comment for nicer stack traces. */

export function globalEval(code: string): any {
	// Indirect eval runs in global scope.
	return (0, eval)(code);
}
