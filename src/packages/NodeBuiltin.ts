import { URL } from '../platform/URL';
import { assign, makeTable, Zalgo } from '../platform/util';
import { unsupported, features } from '../platform/features';
import { nodeRequire } from '../platform/node';
import { Importation } from '../Status';
import { Record } from '../Record';
import { Loader } from '../Loader';
import { LoaderPlugin, pluginFactory, NextResolve, NextFetchRecord, NextInstantiate, NextWrap } from '../Plugin';

let internalNames: string;

try {
	internalNames = nodeRequire('module').builtinModules.join(' ');
} catch(err) {
	internalNames = (
		'assert buffer crypto events fs http https inspector ' +
		'module net os path stream sys tty url util vm zlib'
	);
}

const isInternal = makeTable(internalNames);

type NodeCB<Type> = (err: NodeJS.ErrnoException | null, res?: Type) => void;

/** Node.js load plugin for built-in modules. */

export class NodeBuiltinPlugin implements LoaderPlugin {

	constructor(private loader: Loader) {
		const fs = {
			existsSync: (key: string) => false,
			readFile: (key: string, options: any, cb: NodeCB<any>) => {
				if(typeof options == 'function') cb = options;
				cb(new Error(unsupported + 'fs.readFile'));
			},
			stat: (key: string, cb: NodeCB<any>) => {
				cb(new Error(unsupported + 'fs.stat'));
			}
		};

		const os = {
			homedir: () => '/'
		};

		const path = {
			dirname: (key: string) => {
				let prefix = '';

				if(features.isWin) {
					const parts = key.match(/^([A-Za-z]+:)?(.*)/)!;
					prefix = parts[1] || '';
					key = parts[2];
				}

				const slash = key.lastIndexOf('/', key.length - 2);

				return prefix + key.substr(0, slash + +!slash) || '.';
			},
			extname: (key: string) => {
				const pos = key.lastIndexOf('.');
				const c = key.charAt(pos - 1);

				return (pos < 1 || c == '/' ||
					(features.isWin && c == ':') ? '' : key.substr(pos)
				);
			},
			isAbsolute: (key: string) => (
				key.charAt(0) == '/' ||
				(features.isWin && key.match(/^[A-Za-z]+:\//))
			),
			join: (...paths: string[]) => paths.join('/').replace(/\/\/+/g, '/'),
			normalize: (key: string) => URL.resolve('.', key),
			relative: (base: string, key: string) => {
				return URL.relative(
					URL.resolve('/', URL.fromLocal(base)),
					URL.resolve('/', URL.fromLocal(key))
				);
			},
			resolve: (...args: string[]) => {
				let result = loader.config.cwd || '';

				for(let arg of args) {
					result = URL.resolve(result, arg);
				}

				return result;
			},
			sep: '/'
		};

		const stream = () => { };

		assign(stream, {
			Stream: stream
		});

		const url = URL;

		const util = {
			inherits: (Class: any, Base: any) => {
				function Type(this: any) {
					this.constructor = Class;
				}

				Type.prototype = Base.prototype;
				Class.prototype = new (Type as any)();
			},
			inspect: (val: any) => JSON.stringify(val),
			deprecate: (func: Function, msg: string) => {
				return function(this: any) {
					console.log('Deprecated: ' + msg);
					return func.apply(this, arguments);
				}
			}
		};

		this.nodeShims = { fs, os, path, stream, url, util };
	}

	nodeShims: { [name: string]: any };

	resolve(importation: Importation, next: NextResolve): Zalgo<string> {
		const key = importation.importKey;

		return isInternal[key] ? key : next(importation, this);
	}

	fetchRecord(record: Record, importation: Importation, next: NextFetchRecord): Zalgo<Record> {
		const key = record.resolvedKey;

		return isInternal[key] ? record : next(record, importation, this);
	}

	instantiate(record: Record, next: NextInstantiate): any {
		const key = record.resolvedKey;

		if(!isInternal[key]) return next(record, this);

		return record.moduleInternal!.exports = (
			features.isNode ? nodeRequire(key) : this.nodeShims[key] || {}
		);
	}

	wrap(record: Record, next: NextWrap): string {
		if(!isInternal[record.resolvedKey]) return next(record, this);

		return 'null';
	}

	id?: string;

}

export const NodeBuiltin = pluginFactory('node', NodeBuiltinPlugin);
