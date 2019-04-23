import { Record } from '../Record';
import { ModuleCJS } from '../Module';
import { globalEnv, globalEval, nodeRequire } from '../platform';
import { Loader, LoaderConfig, getLocal, getDir } from '../LoaderBase';

/** CommonJS loader plugin. */

export class CJS extends Loader {

	// constructor(config?: LoaderConfig) {}

	translate(record: Record) {
		const cjsRequire: NodeRequire = (
			(key: string) => {
				const ref = record.depTbl[key];
				return(ref.module ? ref.module.exports : this.instantiate(ref.record!))
			}
		 ) as any;

		// TODO: maybe support cjsRequire.resolve.paths()
		cjsRequire.resolve = (
			(key: string) => this.resolveSync(key, record.resolvedKey)
		) as any;

		// TODO: Object.defineProperty(exports, "__esModule", { value: true });
		const exports = {};

		record.moduleInternal = {
			exports,
			filename: getLocal(record.resolvedKey),
			id: record.resolvedKey,
			loaded: false,
			// TODO: Maybe populate this with guesses.
			paths: [],
			require: cjsRequire
		};
	}

	instantiate(record: Record) {
		const moduleInternal = record.moduleInternal as ModuleCJS;
		let wrapped: () => any;

		try {
			// Compile module into a function under global scope.
			wrapped = globalEval(moduleInternal.exports, record.sourceCode, record.globalTbl, {
				'require': moduleInternal.require,
				'exports': moduleInternal.exports,
				'module': moduleInternal,
				'__filename': moduleInternal.filename,
				'__dirname': getLocal(getDir(record.resolvedKey)),
				'global': globalEnv,
				'GLOBAL': globalEnv
			});
		} catch(err) {
			record.loadError = err;
			throw(err);
		}

		// Disable AMD autodetection in called code.
		const define = globalEnv.define;
		globalEnv.define = undefined;

		let error: any;

		try {
			// Call imported module.
			wrapped();
			moduleInternal.loaded = true;
		} catch(err) {
			error = err;
		}

		// Restore AMD functionality.
		globalEnv.define = define;

		if(error) throw(error);

		return(moduleInternal.exports);
	}

}
