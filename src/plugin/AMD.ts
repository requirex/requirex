import { Record, ModuleFactory } from '../Record';
import { ModuleAMD } from '../Module';
import { globalEnv, globalEval } from '../platform';
import { Loader, LoaderConfig } from '../LoaderBase';

/** AMD (asynchronous module definition) loader plugin. */

export class AMD extends Loader {

	constructor(config?: LoaderConfig) {
		super();
		(this.amdDefine as any).amd = true;
	}

	amdDefine = ((loader: Loader) => function amdDefine(
		key?: string | string[] | ModuleFactory,
		deps?: string[] | ModuleFactory,
		factory?: ModuleFactory
	) {
		// Handle omitted first argument.
		if(typeof(key) != 'string') {
			factory = deps as ModuleFactory;
			deps = key;
			key = void 0;
		}

		// Handle omitted second argument.
		if(!(deps instanceof Array)) {
			factory = deps as ModuleFactory;
			deps = void 0;
		}

		if(typeof(factory) != 'function') {
			const value = factory;
			factory = () => value;
		}

		let record = loader.latestRecord!;
		let resolvedKey = record.resolvedKey;

		if(key) {
			resolvedKey = loader.resolveSync(key, resolvedKey);
		}

		// Resolve relative paths.
		if(!key || key.match(/\.\.?\//)) {
			key = resolvedKey;
		}

		// Add factory to latest record if the name matches or is undefined.
		// Otherwise create a new record.

		if(key != record.importKey && resolvedKey != record.resolvedKey) {
			record = loader.records[key] || (
				loader.records[key] = new Record(loader, key)
			);
		}

		const internalDeps: { [key: string]: number } = {
			'require': -3,
			'exports': -2,
			'module': -1
		};

		if(deps) {
			// Add dependencies to import record and store their indices
			// (offset by 3) for passing them in correct order to the factory.
			// Use indices 0-2 for to allow importing AMD internals:
			// require, exports, module.
			for(let key of deps) {
				record.depNumList.push((internalDeps[key] || record.addDep(key)) + 3);
			}
		} else {
			// If no deps are given, pass the AMD internals in standard order
			// to the factory function.
			record.depNumList = [ 0, 1, 2 ];
		}

		// Disallow redefining a module.
		/* if(record.moduleInternal) {
			throw(new Error('Cannot redefine module "' + key + '"'));
		} */

		record.factory = factory;
	})(this);

	// TODO: Should this be local to a package to support local path mappings?

	amdRequire = ((loader: Loader) => function amdRequire(
		names: string | string[],
		resolve?: (...args: any[]) => any,
		reject?: (err: any) => any,
		referer?: string | Record
	) {
		let record: Record | undefined;

		if(referer instanceof Record) {
			record = referer;
			referer = referer.resolvedKey;
		}

		if(typeof(names) == 'object' && !(names instanceof Array)) {
			// First argument was a config object, remove it.
			return(amdRequire.apply(null, Array.prototype.slice.call(arguments, 1)));
		} else if(typeof(resolve) == 'function') {
			// Asynchronous require().
			if(typeof(names) == 'string') names = [ names ];

			Promise.all(
				names.map((key) => loader.import(key, referer as string | undefined))
			).then(
				((imports: any[]) => resolve.apply(null, imports)),
				reject
			);
		} else if(typeof(names) == 'string') {
			// Synchronous require().
			if(record) {
				const ref = record.depTbl[names];
				if(ref) {
					return(ref.module ? ref.module.exports : record.loader.instantiate(ref.record!));
				}
			}

			const resolvedKey = loader.resolveSync(names, referer);
			const moduleObj = loader.registry[resolvedKey];

			if(!moduleObj) {
				throw(new Error(
					'Module not already loaded loading "' + names +
					'" as "' + resolvedKey + '"' +
					(!referer ? '.' : ' from "' + referer + '".')
				));
			}

			return(moduleObj.exports);
		} else {
			throw(new TypeError('Invalid require'));
		}
	})(this);

	discover(record: Record) {
		const exports = {};

		record.moduleInternal = {
			config: () => {},
			exports,
			id: record.resolvedKey,
			uri: record.resolvedKey
		};

		const define = globalEnv.define;
		globalEnv.define = this.amdDefine;
		this.latestRecord = record;

		try {
			const wrapped = globalEval(globalEnv, record.sourceCode, record.globalTbl, {
				'define': this.amdDefine
			});

			// Call imported module.
			wrapped();
		} catch(err) {
			record.loadError = err;
		}

		this.latestRecord = void 0;
		globalEnv.define = define;
	}

	instantiate(record: Record) {
		const moduleInternal = record.moduleInternal as ModuleAMD;
		const self = this;

		// Dynamic require() function.
		function require(
			names: string | string[],
			resolve?: (...args: any[]) => any,
			reject?: (err: any) => any,
			referer?: string
		) {
			return(self.amdRequire(names, resolve, reject, referer || record));
		}

		// Order must match internalDeps in amdDefine.
		const deps: any[] = [
			require,
			moduleInternal.exports,
			moduleInternal
		].concat(record.depList);

		const args = record.depNumList.map((num) => {
			const dep = deps[num];
			// Return internal deps as-is.
			if(num < 3) return(dep);

			const ref = record.depTbl[dep];
			return(ref.module ? ref.module.exports : this.instantiate(ref.record!));
		});

		const exportsNew = record.factory.apply(null, args);

		if(exportsNew && exportsNew != moduleInternal.exports) {
			moduleInternal.exports = exportsNew;
		}

		return(moduleInternal.exports);
	}

}
