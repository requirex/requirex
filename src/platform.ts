import * as VM from 'vm';

declare const process: any;

export const globalEnv: { [name: string]: any } = typeof(self) == 'object' ? self : global;

export const isNode = (
	typeof(process) == 'object' &&
	Object.prototype.toString.call(process) == '[object process]'
);

export const isWin = (
	isNode &&
	typeof(process.platform) == 'string' &&
	process.platform.substr(0, 3) == 'win'
);

/** Portable replacement for location.origin. */
export const origin = (
	!(
		typeof(window) == 'object' &&
		typeof(location) == 'object' &&
		location == window.location
	) ? '' :
	location.protocol + '//' +
	location.hostname +
	(location.port ? ':' + location.port : '')
);

const nodeRegistry: { [name: string]: any } = {};
const req = typeof(require) == 'function' && require;

export function nodeRequire(name: string) {
	return(nodeRegistry[name] || (
		nodeRegistry[name] = req && req(name)
	));
}

/** Evaluate source code in the global scope. */

export function globalEval(self: any, sourceCode: string, ...defs: { [name: string]: any }[]): () => any {
	const argNames: string[] = [];
	const args: any[] = [];

	for(let def of defs) {
		for(let name in def) {
			if(def.hasOwnProperty(name)) {
				argNames.push(name);
				args.push(def[name]);
			}
		}
	}

	sourceCode = (
		'(function(' + argNames.join(',') + '){' +
		sourceCode +
		// Break possible source map comment on the last line.
		'\n})'
	);

	let compiled: typeof Function;

	if(isNode) {
		const vm: typeof VM = nodeRequire('vm');
		compiled = vm.runInThisContext(sourceCode);
	} else {
		// Indirect eval runs in global scope.
		compiled = (0, eval)(sourceCode);
	}

	sourceCode = '';

	return(function() { return(compiled.apply(self, args)); });
}
