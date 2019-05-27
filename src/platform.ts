import * as VM from 'vm';

declare const process: any;

export const globalEnv: { [name: string]: any } = typeof self == 'object' ? self : global;

const isNode = (
	typeof process == 'object' &&
	Object.prototype.toString.call(process) == '[object process]'
);

let isES6: boolean;

try {
	isES6 = (0, eval)('(...a)=>({a}={a})')().a.length == 0;
} catch(err) {
	isES6 = false;
}

export const features = {
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
