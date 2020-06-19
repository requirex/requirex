import { globalEnv } from '../platform/global';
import { Record } from '../Record';
import { ModuleAMD } from '../ModuleObject';
import { LoaderPlugin, pluginFactory } from '../Plugin';
import { Loader } from '../Loader';

export interface ModuleFactory {
	(...args: any[]): any;

	/** Exists if the factory is a loader plugin. */
	load?: () => any;
}

function initRecord(record: Record) {
	const exports = {};

	// TODO: Add globals.
	// console.log('INIT', record.resolvedKey);

	if(!record.moduleInternal) {
		record.moduleInternal = {
			config: () => { },
			exports,
			id: record.resolvedKey, // record.registryKey,
			uri: record.resolvedKey
		};
	}

	return record;
}

/** AMD (asynchronous module definition) loader plugin. */

export class AMDPlugin implements LoaderPlugin {

	constructor(private loader: Loader) {
		(this.amdDefine as any).amd = true;
	}

	amdDefine = (
		key?: string | string[] | ModuleFactory,
		deps?: string[] | ModuleFactory,
		factory?: ModuleFactory
	) => {
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

		if(typeof factory != 'function' || factory.load) {
			const value = factory;
			factory = () => value;
		}

		let record = this.latestRecord!;
		let resolvedKey = record.resolvedKey;

		if(key) {
			resolvedKey = this.loader.resolveSync(key, resolvedKey);
		}

		// Resolve relative paths.
		if(!key || /(^|\/)\.\.?\//.test(key)) {
			key = resolvedKey;
		}

		if(
			key != this.latestKey &&
			(!record.package || key != record.package.name) &&
			resolvedKey != record.resolvedKey
		) {
			// Add factory to a new record if a name was defined, not matching
			// the containing record's name or package name.

			let subRecord = this.loader.records[key];
			if(subRecord) return;

			subRecord = initRecord(new Record(key, this.loader.newImportation(key)));
			this.loader.records[key] = subRecord;

			record.addBundled(subRecord);
			record = subRecord;

			record.fetched = Promise.resolve(record);

			if(this.loader.defaultPlugin) record.addPlugin(this.loader.defaultPlugin);
			record.addPlugin(this);
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
				record.importNumList.push((internalDeps[key] || record.addImport(key)) + 3);
			}
		} else {
			// If no deps are given, pass the AMD internals in standard order
			// to the factory function.
			record.importNumList = [0, 1, 2];
		}

		record.factory = factory;
	};

	/** Call AMD definition code during analyze() to follow dependencies. */

	analyze(record: Record, importKey: string) {
		initRecord(record);

		// TODO: Is changing global define necessary?
		const define = globalEnv.define;
		globalEnv.define = this.amdDefine;

		this.latestKey = importKey;
		this.latestRecord = record;

		record.setArgs(record.globals, {
			define: this.amdDefine,
			require: this.loader.makeRequire(record),
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

				record.importList = child.importList;
				record.importNumList = child.importNumList;
				record.importTbl = child.importTbl;
				record.factory = child.factory;
			}
		} catch(err) {
			// record.loadError = err;
		}

		this.latestKey = void 0;
		this.latestRecord = void 0;
		// TODO: Is changing global define necessary?
		globalEnv.define = define;
	}

	instantiate(record: Record) {
		const moduleInternal = record.moduleInternal as ModuleAMD;

		const require = this.loader.makeRequire(record);

		// Order must match internalDeps in amdDefine.
		const deps: any[] = [
			require,
			moduleInternal.exports,
			moduleInternal
		].concat(record.importList);

		const args = record.importNumList.map((num) => {
			const dep = deps[num];
			// Return internal deps as-is.
			if(num < 3) return dep;

			const ref = record.importTbl[dep]!;
			return ref.module ? ref.module.exports : this.loader.instantiate(ref.record!);
		});

		const exportsNew = record.factory && record.factory.apply(null, args);

		if(exportsNew && exportsNew != moduleInternal.exports) {
			moduleInternal.exports = exportsNew;
		}

		return moduleInternal.exports;
	}

	latestKey?: string;
	latestRecord?: Record;

	pluginConfig?: any;

	id?: string;

}

export const AMD = pluginFactory('amd', AMDPlugin);
