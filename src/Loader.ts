import { URL, getDir } from './URL';
import { ModuleType } from './Module';
import { Package } from './Package';
import { Record, DepRef, ModuleFormat } from './Record';
import { features, origin, globalEnv } from './platform';
import { fetch, FetchResponse, FetchOptions } from './fetch';

const emptyPromise = Promise.resolve();

export interface LoaderPlugin {
	fetchRecord?(record: Record): Promise<void>;
	fetch?(url: string): Promise<FetchResponse>;

	resolveSync?(key: string, baseKey: string, ref?: DepRef): string;
	resolve?(key: string, baseKey: string, ref?: DepRef): Promise<string> | string;

	discover?(record: Record): Promise<void> | void;

	translate?(record: Record): Promise<void> | void;

	update?(record: Record): Promise<void> | void;

	instantiate?(record: Record): any;

	wrap?(record: Record): string;
}

export interface LoaderConfig {
	baseURL?: string;
	cdn?: string;
	plugins?: { [name: string]: { new(loader: Loader): LoaderPlugin } };
	registry?: { [name: string]: any };
}

export interface SystemDeclaration {
	setters?: ((val: any) => void)[];
	execute?: () => any;
	exports?: any;
}

export type SystemFactory = (exports?: any, module?: ModuleType) => SystemDeclaration;

export interface BuiltSpec {
	name: string;
	root: string;
	main: string;
	map: { [key: string]: string };
	files: [string, ModuleFormat, { [importKey: string]: number }, any][];
}

function handleExtension(loader: Loader, key: string, ref?: DepRef) {
	let format = ref && ref.format;
	let pos = key.lastIndexOf('/') + 1;
	let ext: string | undefined;

	// Check for recognized file extensions starting from
	// the most specific, like .d.ts followed by .ts.
	while((pos = key.indexOf('.', pos) + 1) && !format) {
		ext = key.substr(pos).toLowerCase();
		format = loader.plugins[ext] && ext;
	}

	if(ref) ref.format = format;

	return key;
}

function fetchTranslate(loader: Loader, instantiate: true, importKey: string, parent?: string): Promise<any>;
function fetchTranslate(loader: Loader, instantiate: false, importKey: string, parent?: string): Promise<Record>;
function fetchTranslate(loader: Loader, instantiate: boolean, importKey: string, parent?: string) {
	if((instantiate && loader.registry[importKey]) || loader.records[importKey]) {
		// TODO: avoid unnecessary repeated resolution and / or translation.
	}

	if(!parent && features.isNode) {
		// If no parent module is known,
		// in Node.js we can still use the calling file's path.

		const hook = 'prepareStackTrace';
		const prepareStackTrace = Error[hook];
		Error[hook] = (err, stack) => stack;

		parent = URL.fromLocal(
			(new Error().stack as any as NodeJS.CallSite[])[2].getFileName() || ''
		);

		if(!loader.firstParent) loader.firstParent = parent;

		Error[hook] = prepareStackTrace;
	}

	const ref: DepRef = { isImport: true, package: loader.package };

	const result = loader.resolve(importKey, parent && URL.resolve(parent, '.'), ref).then((resolvedKey: string) =>
		(instantiate && loader.registry[resolvedKey] && loader.registry[resolvedKey].exports) ||
		// Detect and resolve all recursive dependencies.
		loader.discoverRecursive(resolvedKey, importKey, ref!, instantiate).then(
			// Instantiate after translating all detected dependencies.
			// TODO: Make sure this does not get executed multiple times for the same record!
			(record: Record) => Promise.all(record.deepDepList.map(
				(record: Record) => loader.translate(record).then(() => loader.update(record))
			)).then(
				() => instantiate ? loader.instantiate(record) : record
			)
		)
	);

	return result;
}

export class Loader implements LoaderPlugin {

	constructor(config?: LoaderConfig) {
		config = config || {};

		this.cwd = (
			(origin && getDir(window.location.pathname)) ||
			// TODO: Convert backslashes?
			(features.isNode && process.cwd()) ||
			'/'
		);

		this.baseURL = (origin &&
			// TODO: Make sure a slash is added always when missing. Maybe cwd is a drive letter?
			origin + this.cwd + (this.cwd == '/' ? '' : '/')
		);

		this.config(config);
	}

	config(config: LoaderConfig) {
		if(config.baseURL) this.baseURL = config.baseURL;
		if(config.cdn) {
			this.repoTbl[config.cdn] = true;
			this.cdn = config.cdn;
		}

		const registry = config.registry || {};

		for(let name in registry) {
			if(registry.hasOwnProperty(name)) {
				this.registry[name] = { exports: registry[name], id: name };
			}
		}

		const plugins = config.plugins || {};

		for(let name in plugins) {
			if(plugins.hasOwnProperty(name)) {
				const plugin = new plugins[name](this);
				this.plugins[name.toLowerCase()] = plugin;
			}
		}
	}

	/** @param key Name of module or file to import, may be a relative path.
	  * @param parent Resolved URL of a possible parent module. */

	import(importKey: string, parent?: string) {
		return fetchTranslate(this, true, importKey, parent);
	}

	getPackage(key: string) {
		let end = key.length;

		while((end = key.lastIndexOf('/', end - 1)) >= 0) {
			const pkg = this.packageRootTbl[key.substr(0, end)];

			if(pkg && pkg instanceof Package) return pkg;
		}
	}

	resolveSync(key: string, callerKey?: string, ref?: DepRef) {
		let plugin: LoaderPlugin | undefined;

		ref = ref || {};
		const match = key.match(/(^|[/.])([^/.]+)!(.*)$/);

		if(match) {
			ref.format = match[3] || match[2];
			key = key.substr(0, key.indexOf('!'));
		}

		if(ref.format) plugin = this.plugins[ref.format];
		if(!plugin || !plugin.resolveSync) plugin = this.plugins.resolve;

		callerKey = callerKey || this.baseURL || '';

		let resolvedKey = (plugin && plugin.resolveSync ?
			plugin.resolveSync(key, callerKey, ref) :
			URL.resolve(callerKey, key)
		);

		return resolvedKey;
	}

	resolve(key: string, callerKey?: string, ref?: DepRef): Promise<string> {
		let plugin: LoaderPlugin | undefined;

		if(ref && ref.format) plugin = this.plugins[ref.format];
		if(!plugin || !plugin.resolve) plugin = this.plugins.resolve;

		callerKey = callerKey || this.baseURL || '';

		return Promise.resolve(plugin && plugin.resolve ?
			plugin.resolve(key, callerKey, ref) :
			this.resolveSync(key, callerKey, ref)
		).then((resolvedKey: string) => handleExtension(this, resolvedKey, ref));
	}

	fetch(url: string, options?: FetchOptions) {
		const plugin = this.plugins['cache'];

		return (
			(plugin && plugin.fetch ? plugin.fetch : fetch).call(
				plugin,
				url,
				options
			) as Promise<FetchResponse>
		).then((
			(res) => res.ok ? res : Promise.reject(res)
		) as (res: FetchResponse) => FetchResponse);
	}

	fetchRecord(record: Record) {
		let plugin = this.plugins[record.format!];

		if(!plugin || !plugin.fetchRecord) plugin = this.plugins['cache'];

		if(plugin && plugin.fetchRecord) return plugin.fetchRecord(record);

		let fetched: Promise<string>;

		if(record.sourceCode) {
			fetched = Promise.resolve(record.sourceCode);
		} else {
			fetched = this.fetch(record.resolvedKey).then(
				(res: FetchResponse) => res.text()
			);
		}

		return fetched.then((text: string) => {
			record.sourceCode = text;
		});
	}

	/** Resolve and translate an imported dependency and its recursive dependencies.
	  *
	  * @param importKey Dependency name (module or file), may be a relative path.
	  * @param record Import record of module referencing the dependency.
	  * @param base Dependency hierarchy root to instantiate and return from
	  * original import() call. */

	discoverImport(importKey: string, record: Record, instantiate: boolean, base: Record) {
		const ref = record.depTbl[importKey] || { isImport: true };
		const discovered = this.resolve(
			importKey,
			record.resolvedKey,
			ref
		).then((resolvedDepKey: string): Promise<Record | undefined> | undefined => {
			let result: Promise<Record> | undefined;
			const depModule = /* instantiate && */ this.registry[resolvedDepKey];

			if(depModule) {
				// Bind already registered modules as-is.
				ref.module = depModule;
			} else {
				// Bind imported name and the import record,
				// to be registered (synchronously) when required.
				ref.record = base.deepDepTbl[resolvedDepKey];

				// Avoid blocking on previously seen dependencies,
				// to break circular dependency chains.
				if(!ref.record) {
					result = this.discoverRecursive(resolvedDepKey, importKey, ref, instantiate, base);
				}
			}

			record.resolveDep(importKey, ref);
			return result;
		}).catch((err: NodeJS.ErrnoException) => {
			if(err && err.message) {
				err.message += '\n    importing ' + importKey + ' from ' + record.resolvedKey;
			}
			throw err;
		});

		return discovered;
	}

	/** Recursively fetch and translate a file and all its dependencies.
	  *
	  * @param resolvedKey Resolved URL address to fetch.
	  * @param importKey Dependency name before resolving.
	  * @param base Dependency hierarchy root to instantiate and return from
	  * original import() call. */

	discoverRecursive(
		resolvedKey: string,
		importKey: string,
		ref: DepRef,
		instantiate: boolean,
		base?: Record
	): Promise<Record> {
		// This corresponds to code after loader.resolve in SystemJS resolveInstantiate
		// (short path for fully resolved names is in import in our case).
		let record = this.records[resolvedKey] || (
			this.records[resolvedKey] = new Record(this, resolvedKey, importKey, ref.package)
		);

		base = base || record;

		// Store import record in table and wait for it to be translated
		base.deepDepTbl[resolvedKey] = record;
		// Add new recursive dependency to list.
		base.deepDepList.push(record);

		if(!record.discovered) {
			record.format = ref.format as any;
			if(ref.sourceCode) record.sourceCode = ref.sourceCode;

			record.discovered = this.fetchRecord(record).then(
				() => this.discover(record)
			).catch((err: NodeJS.ErrnoException) => {
				if(err && err.message) {
					err.message += '\n    translating ' + record.resolvedKey;
				}
				throw err;
			}).then(() => Promise.all(record.depList.map(
				// Resolve and translate each imported dependency.
				(key: string) => this.discoverImport(key, record, instantiate, base!)
			))).then(() => base!);
		}

		// Store import record in table and wait for it to be translated.
		ref.record = record;

		return record.discovered;
	}

	discover(record: Record): Promise<void> | void {
		const format = record.format;
		const plugin = this.plugins[format!];
		const process = features.isNode ? globalEnv.process : {
			'cwd': () => this.cwd,
			'env': { 'NODE_ENV': 'production' }
		};

		record.globalTbl = { process };

		if(plugin && plugin.discover) {
			return Promise.resolve(
				plugin.discover(record)
			).then(() => {
				if(record.format != format) return this.discover(record);
			});
		}
	}

	translate(record: Record): Promise<void> {
		const format = record.format;

		// Avoid translating code twice using the same format.
		if(record.translated == format) return emptyPromise;
		record.translated = format;

		const plugin = this.plugins[format!];

		if(plugin && plugin.translate) {
			return Promise.resolve(
				plugin.translate(record)
			).then(() => {
				if(record.format != format) {
					return Promise.resolve(
						this.discover(record)
					).then(
						() => this.translate(record)
					);
				}
			});
		} else if(!record.moduleInternal) {
			record.moduleInternal = {
				exports: {},
				id: record.resolvedKey
			};
		}

		return emptyPromise;
	}

	update(record: Record) {
		const plugin = this.plugins['cache'];

		if(plugin && plugin.update) return plugin.update(record);
	}

	instantiate(record: Record) {
		const plugin = this.plugins[record.format!];

		if(record.isInstantiated || !plugin || !plugin.instantiate) {
			return record.moduleInternal.exports;
		}

		record.isInstantiated = true;

		if(record.loadError) {
			throw record.loadError;
		}

		try {
			const exportsOld = record.moduleInternal.exports;
			const exportsNew = plugin.instantiate(record);
			this.registry[record.resolvedKey] = record.moduleInternal;

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

	register(deps: string[], factory: SystemFactory) {
		let record = this.latestRecord;

		if(record) {
			for(let dep of deps) {
				record.depNumList.push(record.addDep(dep) + 3);
			}

			record.factory = factory;
		}
	}

	wrap(record: Record) { return 'null' }

	build(importKey: string, parent?: string) {
		return fetchTranslate(this, false, importKey, parent).then((record: Record) => {
			const pkgTbl: { [name: string]: { package: Package, records: Record[] } } = {};
			const pkgList: string[] = [];

			for(let dep of record.deepDepList) {
				const pkg = dep.pkg || this.package;
				let spec = pkgTbl[pkg.name];

				if(!spec) {
					spec = { package: pkg, records: [] };
					pkgTbl[pkg.name] = spec;
					pkgList.push(pkg.name);
				}

				spec.records.push(dep);
			}

			pkgList.sort();
			let num = 0;

			for(let name of pkgList) {
				for(let dep of pkgTbl[name].records.sort((a: Record, b: Record) =>
					+(a.resolvedKey < b.resolvedKey) - +(a.resolvedKey > b.resolvedKey)
				)) {
					dep.num = num++;
				}
			}

			const str = JSON.stringify;

			return 'System.built(1,[{\n\t' + pkgList.map((name: string) => {
				const spec = pkgTbl[name];
				const pkg = spec.package;
				return [
					'name: ' + str(pkg.name),
					'root: ' + str(pkg.root),
					'main: ' + str(pkg.main),
					'map: ' + str(pkg.map),
					'files: [\n\t\t[\n' + spec.records.map((record: Record) => {
						const plugin = this.plugins[record.format!] || this;
						const code = (plugin.wrap ? plugin : this).wrap!(record);

						const deps: string[] = [];

						for(let depName of record.depList.slice(0).sort()) {
							const dep = record.depTbl[depName].record;
							if(dep) deps.push(str(depName) + ': ' + dep.num);
						}

						return '\t\t\t/* ' + pkg.name + ': ' + record.num! + ' */\n\t\t\t' + [
							str(URL.relative(pkg.root + '/', record.resolvedKey)),
							str(record.format),
							'{' + deps.join(', ') + '}',
							code
						].join(', ');
					}).join('\n\t\t], [\n') + '\n\t\t]\n\t]'
				].join(',\n\t');
			}).join('\n}, {\n\t') + '\n}]);';
		});
	}

	built(version: number, specList: BuiltSpec[]) {
		if(version != 1) throw(new Error('Unsupported bundle format'));

		const recordList: Record[] = [];
		const depsList: { [importKey: string]: number }[] = [];
		let num = 0;

		for(let pkgSpec of specList) {
			const pkg = new Package(pkgSpec.name, pkgSpec.root);
			pkg.main = pkgSpec.main;
			pkg.map = pkgSpec.map;

			this.packageNameTbl[pkg.name] = pkg;
			this.packageConfTbl[pkg.root] = pkg;
			this.packageRootTbl[pkg.root] = pkg;

			for(let [key, format, deps, compiled] of pkgSpec.files) {
				const resolvedKey = URL.resolve(pkg.root + '/', key);
				const record = new Record(this, resolvedKey);

				record.format = format;
				record.compiled = compiled;
				record.discovered = Promise.resolve(record);

				this.records[resolvedKey] = record;
				recordList[num] = record;
				depsList[num++] = deps;
			}
		}

		num = 0;

		for(let record of recordList) {
			const deps = depsList[num++];

			for(let key in deps) {
				if(deps.hasOwnProperty(key)) {
					record.addDep(key, { record: recordList[deps[key]] });
				}
			}

			this.translate(record);
		}
	}

	package = new Package('_', '');
	packageNameTbl: { [name: string]: Package | false | Promise<Package | false> } = {};
	packageConfTbl: { [resolvedRoot: string]: Package | false | Promise<Package | false> } = {};
	/** Map resolved keys to containing packages (keys not corresponding to a package root
	  * resolve to the same result as their parent directory does). */
	packageRootTbl: { [resolvedRoot: string]: Package | false | Promise<Package | false> } = {};
	repoTbl: { [resolvedPath: string]: true } = {}
	cdn: string;

	/** Paths to node-modules directories containing modules under development,
	  * to avoid aggressively caching their contents and better support
	  * boennemann/alle. */

	modulesBustTbl: { [resolvedRoot: string]: boolean } = {};

	registry: { [resolvedKey: string]: ModuleType } = {};

	/** Pending imports. */
	records: { [resolvedKey: string]: Record } = {};
	latestRecord?: Record;

	cwd: string;
	baseURL?: string;
	firstParent?: string;

	plugins: { [name: string]: LoaderPlugin } = {};

}
