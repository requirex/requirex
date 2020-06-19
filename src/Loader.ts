import { FetchResponse, FetchOptions } from './platform/fetch';
import { URL } from './platform/URL';
import { features } from './platform/features';
import { getCallerKey, nodeRequire } from './platform/node';
import { Zalgo, assign, keys, getDir, appendSlash, emptyPromise } from './platform/util';
import { WorkerManager } from './worker/WorkerManager';
import { WorkerCallee } from './worker/WorkerCallee';
import { RequireX } from './RequireX';
import { Status, Importation } from './Status';
import { ModuleObject } from './ModuleObject';
import { Package } from './packages/Package';
import { Record, BuiltSpec } from './Record';
import {
	LoaderPlugin,
	BasePlugin,
	PluginStack,
	PluginSpec,
	nextResolveSync,
	nextResolve,
	nextFetch,
	nextFetchRecord,
	nextAnalyze,
	nextTranslate,
	nextInstantiate,
	nextBuild,
	nextBuilt,
	nextCache
} from './Plugin';

const defaultExtension = 'js';

export interface LoaderConfig {

	baseURL?: string;

	/** Currect working directory. */
	cwd?: string;

	defaultFormat?: string | PluginSpec;

	formats?: { [extension: string]: string | PluginSpec };

	/** Global variables exposed to instantiated code. */
	globals?: { [name: string]: any };

	/** Starting point for finding packages needed to support different module
	  * formats and markup languages. Default: file making the first import. */
	libraryBaseKey?: string;

	/** Overrides for package name resolution. */
	map?: { [name: string]: string };

	/** Factory functions for loader plugins. */
	plugins?: PluginSpec[];

	pluginConfig?: { isBuild?: boolean };

	specials?: { [name: string]: PluginSpec[] };

	/** Module contents mapped to predefined import names. */
	registry?: { [name: string]: any };

}

export class Loader {

	constructor(public external: RequireX) {
		this.pluginStack = { plugin: new BasePlugin(this) };

		const manager = features.hasWorker && WorkerManager.createManager(this);
		if(manager) this.workerManager = manager;
	}

	setCallee(worker: WorkerCallee) {
		this.workerCallee = worker;
	}

	/** Apply new configuration options. */

	setConfig(config: LoaderConfig) {
		// Copy contents of new configuration with recursion depth 1
		// to also keep current plugins, globals and registry.
		assign(this.config, config, 1);

		if(config.baseURL) {
			const url = URL.parse(config.baseURL);
			const cwd = getDir(url.pathname || '') || '/';

			if(!config.cwd) {
				this.config.cwd = cwd;
			}

			features.origin = url.origin;
			this.config.baseURL = url.origin + appendSlash(cwd);
		}

		// Set up modules with predefined exports objects.
		const registry = config.registry || {};

		for(let name of keys(registry)) {
			const module = { exports: registry[name], id: name };
			const record = this.records[name] || new Record(name, this.newImportation(name));

			record.moduleInternal = module;
			record.fetched = Promise.resolve(record);

			this.registry[name] = module;
			this.records[name] = record;
		}

		// Initialize loader plugins.
		const plugins = config.plugins || [];
		let num = plugins.length;

		while(num--) {
			this.pluginStack = {
				plugin: this.initPlugin(plugins[num]),
				next: this.pluginStack
			};
		}

		const formats = config.formats || {};

		for(let extension of keys(formats)) {
			const plugin = formats[extension];

			if(typeof plugin != 'string') {
				this.extensionTbl[extension] = this.initPlugin(plugin);
			}
		}

		for(let extension of keys(formats)) {
			const name = formats[extension];

			if(typeof name == 'string') {
				this.extensionTbl[extension] = this.extensionTbl[name];
			}
		}

		const defaultFormat = config.defaultFormat;

		if(typeof defaultFormat == 'string') {
			this.defaultPlugin = this.extensionTbl[defaultFormat];
		} else if(defaultFormat) {
			this.defaultPlugin = this.initPlugin(defaultFormat);
		}

		// Initialize records that have their own custom plugins.
		const specials = config.specials || {};

		for(let name of keys(specials)) {
			const record = new Record(name, this.newImportation(name));

			for(let plugin of specials[name]) {
				record.addPlugin(this.initPlugin(plugin));
			}

			this.records[name] = record;
		}

		// Apply package name resolution overrides.
		assign(this.package.map, config.map || {}, 0);
	}

	/** Initialize a loader plugin.
	  *
	  * @param plugin Factory function, calling the plugin constructor
	  * curried with configuration options.
	  * @return Plugin instance. */

	initPlugin(spec: PluginSpec) {
		const id = spec.Plugin.prototype.id;
		let pluginInstance = this.pluginTbl[id];

		if(!pluginInstance) {
			const manager = this.workerManager;
			const callee = this.workerCallee;
			const { Plugin, Worker } = spec;
			// If the plugin has a separate worker class, check if Web Workers
			// are available. If unsupported or inside a worker, run methods
			// in the current thread.
			const workerInstance = Worker && (!manager ? new Worker(this, spec.config) :
				// Set up an RPC proxy passing method calls to workers.
				manager.makeProxy(Worker.prototype, id)
			);

			pluginInstance = new Plugin(this, spec.config, workerInstance);

			if(manager) {
				manager.register(Plugin, pluginInstance);
			}

			if(callee) {
				// Inside workers, register the plugin's worker class
				// to handle incoming messages.
				if(Worker && workerInstance) callee.register(id, workerInstance);
				callee.makeProxy(Plugin);
			}

			this.pluginTbl[id] = pluginInstance;
		}

		return pluginInstance;
	}

	getDefaultPlugin(extension?: string) {
		return extension ? this.extensionTbl[extension] : this.defaultPlugin;
	}

	getExtension(resolvedKey: string) {
		let plugin: LoaderPlugin | undefined;
		let pos = resolvedKey.lastIndexOf('/') + 1;
		let ext: string | undefined;

		// Check for recognized file extensions starting from
		// the most specific, like .d.ts followed by .ts.
		while((pos = resolvedKey.indexOf('.', pos) + 1) && !plugin) {
			ext = resolvedKey.substr(pos).toLowerCase();
			plugin = this.getDefaultPlugin(ext);
		}

		return ext;
	}

	/** Set up metadata for coordinating a recursive import.
	  *
	  * @return Status object used during the import process. */

	newStatus() {
		const status: Status = {
			importTbl: {},
			document: features.doc
		};

		return status;
	}

	/** Set up metadata for importing a single file. */

	newImportation(
		importKey: string,
		baseKey?: string,
		status?: Status,
		parent?: Record
	) {
		const pos = baseKey && baseKey.indexOf('!') + 1;
		if(pos) baseKey = baseKey!.substr(pos);

		const importation: Importation = {
			baseKey: baseKey || this.config.baseURL,
			extensionList: [],
			importKey,
			package: this.package,
			parent,
			pluginStack: this.pluginStack,
			status: status || this.defaultStatus
		};

		return importation;
	}

	eval(code: string, resolvedKey?: string, importKey = '[eval]') {
		const status = this.newStatus();
		const importation = this.newImportation(importKey, void 0, status);

		importation.sourceCode = code;

		const record = new Record(
			resolvedKey || this.config.baseURL + importKey,
			importation
		);

		record.addPlugin(this.getDefaultPlugin());

		return this.analyzeAll(record, status, importKey).then(
			(record) => this.translateInstantiate(record, status, importKey!)
		);
	}

	/** @param resolve Callback.
	  * @param reject Errback. */

	require(
		names: string | string[],
		resolve?: (...args: any[]) => any,
		reject?: (err: any) => any,
		referer?: string | Record,
		config?: any
	): any {
		let record: Record | undefined;

		if(referer instanceof Record) {
			record = referer;
			referer = referer.resolvedKey;
		}

		if(typeof names == 'object' && !(names instanceof Array)) {
			// First argument was a config object, make it the last one.
			return this.require(resolve as any, reject, referer as any, config, names);
		} else if(typeof resolve == 'function') {
			// Asynchronous require().
			if(typeof names == 'string') names = [names];

			Promise.all(
				names.map((key) => this.import(key, referer as string | undefined))
			).then(
				((imports: any[]) => resolve.apply(null, imports)),
				reject
			);
		} else if(typeof names == 'string') {
			return this.importSync(names, referer, record);
		} else {
			throw new TypeError('Invalid require');
		}
	};

	makeRequire(record: Record, baseKey = record.resolvedKey) {
		// Dynamic require() function.
		const require = (
			names: string | string[],
			resolve?: (...args: any[]) => any,
			reject?: (err: any) => any,
			referer?: string
		) => this.require(names, resolve, reject, referer || record);

		require.toUrl = (key: string) => {
			const result = this.resolveSync(key, baseKey);
			return result;
		}

		return require;
	}

	/** Synchronous import, like Node.js require(). */

	importSync(importKey: string, baseKey?: string, parent?: Record) {
		if(parent) {
			const importation = parent && parent.importTbl[importKey];

			if(importation) {
				return importation.module ? importation.module.exports : (
					this.instantiate(importation.record!)
				);
			}
		}

		const resolvedKey = this.resolveSync(importKey, baseKey);
		const moduleObj = this.registry[resolvedKey];

		if(!moduleObj) {
			if(resolvedKey.substr(0, 5) == 'file:') {
				// TODO: Currently this silently returns an empty module on failure...
				return nodeRequire(URL.toLocal(resolvedKey));
			} else {
				throw new Error(
					'Module not already loaded loading "' + importKey +
					'" as "' + resolvedKey + '"' +
					(!baseKey ? '.' : ' from "' + baseKey + '".')
				);
			}
		}

		return moduleObj.exports;
	}

	/** Loader main entry point, called from the public API.
	  * Resolve, fetch, translate and execute a file and all its dependencies.
	  *
	  * @param meta Object for storing output metadata,
	  * to provide resolved custom plugin addresses during import. */

	import(importKey: string, baseKey?: string, meta?: { resolvedKey?: string }): Promise<any> {
		/** Recursive import metadata, for handling circular dependencies etc. */
		const status = this.newStatus();

		status.isImport = true;
		status.isInstantiation = true;

		if(!baseKey && features.isNode) {
			// If no parent module is known,
			// in Node.js we can still use the calling file's path.

			baseKey = URL.fromLocal(
				// Argument is number of stack frames between calls to
				// RequireX.import and getCallerKey.
				getCallerKey(2) ||
				appendSlash(this.config.cwd!)
			);
		}

		if(!this.config.libraryBaseKey) {
			// Use location of the first import as a starting point for
			// finding third party packages required by loader plugins.
			this.config.libraryBaseKey = baseKey;
		}

		return Promise.resolve(this.resolveFetchAnalyzeAll(importKey, baseKey, status)).then(
			(record) => this.translateInstantiate(record, status, importKey, meta)
		);
	}

	translateInstantiate(record: Record | undefined, status: Status, importKey: string, meta?: { resolvedKey?: string }) {
		return record && Promise.resolve(this.translateAll(record, status, importKey)).then(() => {
			if(meta) meta.resolvedKey = record!.resolvedKey;

			let result = this.instantiate(record!);
			record = this.bundleMain;

			if(record) {
				result = this.analyzeAll(record, status, record.resolvedKey).then(
					(record) => this.translateInstantiate(record, status, record.resolvedKey)
				);

				this.bundleMain = void 0;
			}

			return result;
		});
	}

	resolveFetchAnalyzeAll(
		importKey: string,
		baseKey: string | undefined,
		status: Status,
		/** Record for file / script making the import. */
		parent?: Record
	) {
		// Re-use previous result if the exact same unresolved import name was
		// already used in the same parent record.
		let importation = (parent && parent.importTbl[importKey]) as Importation;

		// If no parent record was given, try to find one for the
		// importing address.
		parent = parent || (baseKey && this.records[baseKey]) || parent;

		if(importation) {
			if(importation.result) return importation.result;
			importation.status = status;
		} else {
			importation = this.newImportation(
				importKey,
				baseKey,
				status,
				parent
			);
		}

		if(parent) {
			// Cache result for parent record and unresolved import name.
			parent.importTbl[importKey] = importation;
		} else {
			// If parent record is unknown, its resolve hook cannot define
			// default file extensions, so handle that here.
			importation.extensionList = [defaultExtension];
		}

		// Resolve, fetch, analyze, repeat recursively for dependencies.
		return importation.result = this.resolve(importKey, baseKey, importation).then(
			(resolvedKey) => this.fetchAnalyzeAll(resolvedKey, importKey, importation)
		);
	}

	fetchAnalyzeAll(
		resolvedKey: string,
		importKey: string,
		importation: Importation
	) {
		const status = importation.status;

		// Bail out if record is already being imported, to avoid
		// analyzing and following dependencies multiple times.
		let fetched = status.importTbl[resolvedKey];
		if(fetched) {
			return fetched.then(
				(record) => record && (importation.record = record)
			);
		}

		// We are importing the record for the first time.
		// Cache the fetch promise to avoid re-importing.
		fetched = this.fetchRecord(resolvedKey, importation);
		status.importTbl[resolvedKey] = fetched;

		// After the first fetch is done, importation result still awaits
		// analyzing and following dependencies. Results for later imports
		// skip them, to avoid blocking on circular dependencies.
		return fetched.then((record): Zalgo<Record | undefined> => {
			if(record) {
				importation.record = record;

				// Some formats run eval() in the analyze step
				// so inject globals before that.
				record.addGlobals(this.config.globals || {});

				return this.analyzeAll(record, status, importKey);
			}
		});
	}

	analyzeAll(record: Record, status: Status, importKey: string): Promise<Record> {
		if(!record.isAnalyzed) record.extractSourceMap();

		return this.analyze(record, importKey).then(() => {
			return Promise.all(record.importList.map((importKey) =>
				this.resolveFetchAnalyzeAll(importKey, record.resolvedKey, status, record)
			)).then(() => record)
		});
	}

	resolveSync(importKey: string, baseKey?: string, importation?: Importation) {
		if(!importation) {
			importation = this.newImportation(importKey, baseKey);
			importation.extensionList = [defaultExtension];
		}

		return nextResolveSync(importation, null);
	}

	resolve(importKey: string, baseKey?: string, importation?: Importation) {
		if(!importation) {
			importation = this.newImportation(importKey, baseKey);
			importation.extensionList = [defaultExtension];
		}

		return Promise.resolve(
			this.records[importKey] ? importKey : nextResolve(importation, null)
		).catch(
			() => this.resolveSync(importKey, baseKey, importation)
		);
	}

	fetch(resolvedKey: string, options?: FetchOptions, ref?: Importation | Record) {
		return Promise.resolve(
			nextFetch(resolvedKey, options, null, (ref || this).pluginStack)
		).then(
			((res) => res.ok ? res : Promise.reject(new Error(
				'HTTP error ' + res.status + ' fetching ' + resolvedKey
			))) as (res: FetchResponse) => FetchResponse
		);
	}

	fetchRecord(resolvedKey: string, importation: Importation): Promise<Record | undefined> {
		const moduleObject = this.registry[resolvedKey];
		let record = this.records[resolvedKey];

		if(moduleObject) {
			importation.module = moduleObject;
			return Promise.resolve(record);
		} else if(!record) {
			record = new Record(resolvedKey, importation);
			this.records[resolvedKey] = record;
		}

		return record.fetched || (
			record.fetched = Promise.resolve(
				nextFetchRecord(record, importation, null)
			).then(
				() => record!
			)
		);
	}

	analyzeSync(record: Record, importKey: string) {
		let frame: PluginStack;
		let result: Zalgo<void> | undefined;

		if(!record.isAnalyzed) {
			record.extractSourceMap();

			do {
				frame = record.pluginStack;
				result = result || nextAnalyze(record, importKey, null);
			} while(record.pluginStack != frame);

			record.isAnalyzed = true;
		}

		return result;
	}

	translateSync(record: Record, importKey: string) {
		let frame: PluginStack;
		let result: Zalgo<void> | undefined;

		record.isTranslating = true;

		while(1) {
			frame = record.pluginStack;
			result = result || nextTranslate(record, null);

			if(record.pluginStack == frame) break;

			// Re-analyze if plugins change.
			record.isAnalyzed = void 0;
			result = result || this.analyzeSync(record, importKey);
		}

		return result;
	}

	analyze(record: Record, importKey: string): Promise<void> {
		if(record.isAnalyzed) return emptyPromise;

		const frame = record.pluginStack;

		return Promise.resolve(nextAnalyze(record, importKey, null)).then(() => {
			// Re-analyze if plugins change.
			if(record.pluginStack != frame) {
				return this.analyze(record, importKey);
			} else {
				record.isAnalyzed = true;
			}
		});
	}

	translate(record: Record, status: Status, importKey: string): Promise<void> {
		const frame = record.pluginStack;
		record.isTranslating = true;

		return Promise.resolve(nextTranslate(record, null)).then(() => {
			// Re-analyze if plugins change.
			if(record.pluginStack != frame) {
				record.isAnalyzed = void 0;
				return this.analyzeAll(record, status, importKey).then(
					() => this.translate(record, status, importKey)
				);
			} else {
				return this.cache(record);
			}
		});
	}

	translateAll(record: Record, status: Status, importKey: string): Promise<void> {
		return record.isTranslating ? emptyPromise : this.translate(record, status, importKey).then(
			() => Promise.all(record.importList.map((importKey) => {
				const dep = record.importTbl[importKey]!.record;
				return dep && this.translateAll(dep, status, importKey);
			}))
		).then(() => { });
	}

	cache(record: Record) {
		if(record.isDirty) {
			record.isDirty = false;
			return nextCache(record, null);
		}
	}

	instantiate(record: Record) {
		if(!record) debugger;
		if(!record.moduleInternal) return;

		const exportsOld = record.moduleInternal!.exports;

		if(record.isInstantiated) return exportsOld;
		record.isInstantiated = true;

		/* if(record.loadError) {
			throw record.loadError;
		} */

		try {
			const exportsNew = nextInstantiate(record, null);

			// TODO
			const cacheKey = record.resolvedKey;
			this.registry[cacheKey] = record.moduleInternal;

			if(exportsNew != exportsOld) {
				// TODO: for circular deps, the previous exports may be in use!
				// Should define getters and setters to share members
				// or at least copy them over...
			}

			return exportsNew;
		} catch(err) {
			if(err && err.message) {
				err.message += '\n    instantiating ' + record.resolvedKey;
			}
			throw err;
		}
	}

	build(importKey: string, baseKey?: string) {
		const status = this.newStatus();

		status.isImport = false;
		status.isInstantiation = false;

		return Promise.resolve(this.resolveFetchAnalyzeAll(importKey, baseKey, status)).then((record) => {
			if(!record) throw new Error('Error fetching ' + importKey + ' for bundling');

			return Promise.resolve(
				this.translateAll(record, status, importKey)
			).then(
				() => nextBuild(record, baseKey || this.config.baseURL || '', null)
			);
		});
	}

	built(main: number, specList: BuiltSpec[]) {
		const packageList = nextBuilt(
			specList,
			this.config.baseURL || this.config.libraryBaseKey || '',
			null,
			this.pluginStack
		);
		const recordList: Record[] = [];
		const depsList: { [importKey: string]: number }[] = [];
		let specNum = 0;
		let recordNum = 0;

		for(let pkgSpec of specList) {
			const pkg = packageList[specNum++];

			for(let [key, plugins, deps, compiled] of pkgSpec.files) {
				const resolvedKey = !pkg.rootKey ? key : URL.resolve(pkg.rootKey + '/', key);
				let record = this.records[resolvedKey];

				if(!record) {
					const importation = this.newImportation(resolvedKey);
					importation.extension = this.getExtension(resolvedKey);

					record = new Record(resolvedKey, importation);

					for(let num = plugins.length; num--;) {
						const plugin = this.pluginTbl[plugins[num]];
						record.addPlugin(plugin);
					}

					record.addGlobals(this.config.globals || {});
					record.compiled = compiled;
					record.fetched = Promise.resolve(record);

					this.records[resolvedKey] = record;
				}

				recordList[recordNum] = record;
				depsList[recordNum++] = deps;
			}
		}

		recordNum = 0;

		for(let record of recordList) {
			const deps = depsList[recordNum++];

			for(let key of keys(deps)) {
				const depNum = deps[key];

				const importation = this.newImportation(key);
				importation.result = emptyPromise;

				if(depNum < 0) {
					importation.module = this.registry[key];
				} else {
					importation.record = recordList[depNum];
				}

				record.addImport(key, importation);
			}

			if(
				this.analyzeSync(record, record.resolvedKey) ||
				this.translateSync(record, record.resolvedKey)
			) {
				throw new Error('Async plugins are not supported in bundles');
			}
		}

		this.bundleMain = recordList[main];
	}

	private workerManager?: WorkerManager;
	workerCallee?: WorkerCallee;

	/** Default plugin stack applied to all imports. */
	pluginStack: PluginStack;

	/** Current configuration options. */
	config: LoaderConfig = { cwd: '/' };

	pluginTbl: { [name: string]: LoaderPlugin | undefined } = {};
	extensionTbl: { [name: string]: LoaderPlugin | undefined } = {};
	defaultPlugin?: LoaderPlugin;

	/** Root package for modules without a path, such as the Node.js API. */
	package = new Package('_', '');

	private defaultStatus = this.newStatus();

	records: { [cacheKey: string]: Record | undefined } = {};
	registry: { [cacheKey: string]: ModuleObject | undefined } = {};
	bundleMain?: Record;

}
