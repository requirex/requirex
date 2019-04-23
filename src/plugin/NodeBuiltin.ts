import { isWin } from '../platform';

import { URL } from '../URL';
import { Record } from '../Record';
import { nodeRequire } from '../platform';
import { Loader, LoaderConfig } from '../LoaderBase';

declare module '../Loader' {
	interface Loader {
		nodeShims: { [name: string]: any };
	}
}

const emptyPromise = Promise.resolve();

function makeShims(loader: Loader) {
	return({
		path: {
			dirname: (key: string) => {
				let prefix = '';

				if(isWin) {
					const parts = key.match(/^([A-Za-z]+:)?(.*)/)!;
					prefix = parts[1] || '';
					key = parts[2];
				}

				const slash = key.lastIndexOf('/', key.length - 2);

				return(prefix + key.substr(0, slash + +!slash) || '.');
			},
			extname: (key: string) => {
				const pos = key.lastIndexOf('.');
				const c = key.charAt(pos - 1);

				return(pos < 1 || c == '/' || (isWin && c == ':') ? '' : key.substr(pos));
			},
			isAbsolute: (key: string) => (
				key.charAt(0) == '/' ||
				(isWin && key.match(/^[A-Za-z]+:\//))
			),
			resolve: (...args: string[]) => {
				let result = loader.cwd;

				for(let arg of args) {
					result = URL.resolve(result, arg);
				}

				return(result);
			},
			sep: '/'
		},
		util: {
			// TODO
			inherits: () => {}
		}
	} as { [name: string]: any });
}

/** Node.js load plugin for built-in modules. */

export class NodeBuiltin extends Loader {

	fetchRecord(record: Record) {
		return(emptyPromise);
	}

	instantiate(record: Record) {
		if(!this.nodeShims) this.nodeShims = makeShims(this);
		// return((record.moduleInternal.exports = nodeRequire(record.resolvedKey)));

		const native = nodeRequire(record.resolvedKey);
		const shim = this.nodeShims[record.resolvedKey] || {};

		for(let name in native) {
			record.moduleInternal.exports[name] = shim[name] || function() {
				return(native[name].apply(native, arguments));
			};
		}

		return(record.moduleInternal.exports);
	}

}
