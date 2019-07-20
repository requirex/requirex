import { URL, getDir } from '../URL';
import { Record } from '../Record';
import { ModuleCJS } from '../Module';
import { globalEnv, globalEval } from '../platform';
import { Loader, LoaderPlugin } from '../Loader';

/** CommonJS loader plugin. */

export class CJS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	translate(record: Record) {
		const loader = this.loader;

		const cjsRequire: NodeRequire = (
			(key: string) => {
				const ref = record.depTbl[key];
				if(ref) {
					return ref.module ? ref.module.exports : loader.instantiate(ref.record!);
				}

				const resolvedKey = loader.resolveSync(key, record.resolvedKey);
				const moduleObj = loader.registry[resolvedKey];

				return moduleObj.exports;
			}
		) as any;

		// TODO: maybe support cjsRequire.resolve.paths()
		cjsRequire.resolve = (
			(key: string) => loader.resolveSync(key, record.resolvedKey)
		) as any;

		// TODO: Object.defineProperty(exports, "__esModule", { value: true });
		const exports = {};

		const moduleInternal = record.moduleInternal = {
			exports,
			filename: URL.toLocal(record.resolvedKey),
			id: record.resolvedKey,
			loaded: false,
			// TODO: Maybe populate this with guesses.
			paths: [],
			require: cjsRequire
		};

		record.setArgs(record.globalTbl, {
			'require': moduleInternal.require,
			'exports': moduleInternal.exports,
			'module': moduleInternal,
			'__filename': moduleInternal.filename,
			'__dirname': URL.toLocal(getDir(record.resolvedKey)),
			'global': globalEnv,
			'GLOBAL': globalEnv
		});
	}

	instantiate(record: Record) {
		const moduleInternal = record.moduleInternal as ModuleCJS;
		let compiled = record.compiled;

		if(!compiled && !record.eval) {
			try {
				// Compile module into a function under global scope.
				compiled = globalEval(record.wrap(true));
			} catch(err) {
				record.loadError = err;
				throw err;
			}
		}

		// Disable AMD autodetection in called code.
		const define = globalEnv.define;
		globalEnv.define = undefined;

		let error: any;

		try {
			// Call imported module.
			if(record.eval) {
				record.eval(record);
			} else {
				compiled.apply(moduleInternal.exports, record.argValues);
			}

			moduleInternal.loaded = true;
		} catch(err) {
			error = err;
		}

		// Restore AMD functionality.
		globalEnv.define = define;

		if(error) throw error;

		return moduleInternal.exports;
	}

	wrap(record: Record) {
		return record.wrap();
	}

}
