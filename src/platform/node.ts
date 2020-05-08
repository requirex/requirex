const nodeRegistry: { [name: string]: any } = {};

export function nodeRequire(name: string) {
	return nodeRegistry[name] || (
		nodeRegistry[name] = typeof require == 'function' ? require(name) : {}
	);
}

/** Get path of calling script.
  *
  * @param depth Number of calls in the stack on top of the desired script.
  *
  * @return Absolute local path of the calling script, or null on failure
  * (eg. call was made directly from the command line or an eval statement). */

export function getCallerKey(depth: number) {
	const hook = 'prepareStackTrace';
	const prepareStackTrace = Error[hook];

	Error[hook] = (err, stack) => stack;
	let name = (new Error().stack as any as NodeJS.CallSite[])[depth + 1].getFileName();
	Error[hook] = prepareStackTrace;

	if(!name || typeof name != 'string' || name.charAt(0) == '[') {
		return null;
	}

	return name;
}
