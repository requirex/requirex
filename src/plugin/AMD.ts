import { Record, ModuleFactory } from '../Record';
import { ModuleAMD } from '../Module';
import { globalEnv } from '../platform';
import { Loader, LoaderPlugin } from '../Loader';

function initRecord(record: Record) {
	const exports = {};

	// TODO: Add globals.

	record.moduleInternal = {
		config: () => { },
		exports,
		id: record.resolvedKey,
		uri: record.resolvedKey
	};

	return record;
}

/** AMD (asynchronous module definition) loader plugin. */

export class AMD implements LoaderPlugin {

	constructor(private loader: Loader) {
		(this.amdDefine as any).amd = true;
	}

	amdDefine = ((loader: Loader) => function amdDefine(
		key?: string | string[] | ModuleFactory,
		deps?: string[] | ModuleFactory,
		factory?: ModuleFactory
	) {
		// Handle omitted first argument.
		if(typeof key != 'string') {
			factory = deps as ModuleFactory;
			deps = key;
			key = void 0;
		}

		// Handle omitted second argument.
		if(!(deps instanceof Array)) {
			factory = deps as ModuleFactory;
			deps = void 0;
		}

		if(typeof factory != 'function') {
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

		if(
			key != record.importKey &&
			(!record.pkg || key != record.pkg.name) &&
			resolvedKey != record.resolvedKey
		) {
			// Add factory to latest record if the name matches or is undefined.
			// Otherwise create a new record.

			record = record.addBundled(loader.records[key] || (
				loader.records[key] = initRecord(new Record(loader, key))
			));
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
			record.depNumList = [0, 1, 2];
		}

		// Disallow redefining a module.
		/* if(record.moduleInternal) {
			throw new Error('Cannot redefine module "' + key + '"');
		} */

		record.factory = factory;
	})(this.loader);

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

		if(typeof names == 'object' && !(names instanceof Array)) {
			// First argument was a config object, remove it.
			return amdRequire.apply(null, Array.prototype.slice.call(arguments, 1));
		} else if(typeof resolve == 'function') {
			// Asynchronous require().
			if(typeof names == 'string') names = [names];

			Promise.all(
				names.map((key) => loader.import(key, referer as string | undefined))
			).then(
				((imports: any[]) => resolve.apply(null, imports)),
				reject
			);
		} else if(typeof names == 'string') {
			return loader.require(names, referer, record);
		} else {
			throw new TypeError('Invalid require');
		}
	})(this.loader);

	discover(record: Record) {
		initRecord(record);

		// TODO: Is changing global define necessary?
		const define = globalEnv.define;
		globalEnv.define = this.amdDefine;
		this.loader.latestRecord = record;
		record.setArgs(record.globalTbl, {
			define: this.amdDefine,
			require: this.amdRequire,
			global: globalEnv,
			GLOBAL: globalEnv
		});

		try {
			const compiled = record.compiled || record.wrap();

			// Call imported module.
			compiled.apply(globalEnv, record.argValues);

			// If only one module was defined but with a strange key not
			// matching the file name, assume it was still meant as the exports.
			if(!record.factory && record.bundleChildren && record.bundleChildren.length == 1) {
				const child = record.bundleChildren[0];

				record.depList = child.depList;
				record.depNumList = child.depNumList;
				record.depTbl = child.depTbl;
				record.factory = child.factory;
			}
		} catch(err) {
			record.loadError = err;
		}

		this.loader.latestRecord = void 0;
		// TODO: Is changing global define necessary?
		globalEnv.define = define;
	}

	translate(record: Record) {
		// Simulate Dojo loader, call plugin load hooks for all dependencies.
		return Promise.all(record.depNumList.map((num) => {
			if(num < 3) return false;

			const dep = record.depList[num];
			const ref = record.depTbl[dep];

			if(ref && ref.plugin && ref.plugin.load && !ref.plugin.normalize) {
				return new Promise((resolve) =>
					ref.plugin.load(
						ref.pluginArg,
						(key: string) => this.loader.resolveSync(key, record.resolvedKey),
						resolve
					)
				).then((exports) => {
					ref.module = {
						id: ref.record!.resolvedKey + '!' + ref.pluginArg,
						exports
					};

					return false;
				});
			}

			return false;
		})).then(() => {});
	}

	instantiate(record: Record) {
		const moduleInternal = record.moduleInternal as ModuleAMD;

		// Dynamic require() function.
		const require = (
			names: string | string[],
			resolve?: (...args: any[]) => any,
			reject?: (err: any) => any,
			referer?: string
		) => this.amdRequire(names, resolve, reject, referer || record);

		// Simulate Dojo loader method.
		require.toUrl = (key: string) => this.loader.resolveSync(key, record.resolvedKey);

		// Order must match internalDeps in amdDefine.
		const deps: any[] = [
			require,
			moduleInternal.exports,
			moduleInternal
		].concat(record.depList);

		const args = record.depNumList.map((num) => {
			const dep = deps[num];
			// Return internal deps as-is.
			if(num < 3) return dep;

			const ref = record.depTbl[dep]!;
			return ref.module ? ref.module.exports : this.loader.instantiate(ref.record!);
		});

		const exportsNew = record.factory.apply(null, args);

		if(exportsNew && exportsNew != moduleInternal.exports) {
			moduleInternal.exports = exportsNew;
		}

		return moduleInternal.exports;
	}

	wrap(record: Record) {
		return record.withWrapper();
	}

}
