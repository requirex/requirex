import { URL } from '../platform/URL';
import { FetchResponse } from '../platform/fetch';
import { keys, emptyPromise, Zalgo } from '../platform/util';
import { PackageManager, rootPathLookup, CDN } from '../packages/PackageManager';
import { rePackage, removeSlash, getRepoPaths } from '../packages/PackageManagerNode';
import { Package } from '../packages/Package';
import { fetchLock } from '../packages/fetchLock';
import { fetchContainingPackage } from '../packages/fetchContainingPackage';
import { fetchPackage } from '../packages/fetchPackage';
import { Importation, addPlugin } from '../Status';
import { BuiltSpec } from '../Record';
import { LoaderPlugin, pluginFactory } from '../Plugin';
import { Loader } from '../Loader';

interface ResolveState {

	baseKey: string;
	count: number;
	importation: Importation;
	importKey: string;
	loader: Loader;
	manager: PackageManager;
	pkg: Package;
	resolvedKey: string;

}

function resolvePackageMaps(state: ResolveState) {
	let { baseKey, importKey, pkg } = state;
	let prevKey: string | undefined;
	const map = state.loader.package.map;

	const pos = importKey.indexOf('/') + 1
	if(pos && importKey.substr(0, pos) == baseKey.substr(0, pos)) {
		state.resolvedKey = importKey;
		return;
	}

	while(importKey != prevKey && --state.count) {
		let lookupKey = importKey;
		let rootKey = rootPathLookup(lookupKey, pkg.map) || rootPathLookup(lookupKey, map);

		if(!rootKey) {
			lookupKey = state.resolvedKey = URL.resolve(baseKey, importKey);
			// TODO: Handle default extensions and possible wildcards.
			rootKey = rootPathLookup(lookupKey, pkg.map) || rootPathLookup(lookupKey, map);
		}

		if(!rootKey) break;

		prevKey = importKey;
		importKey = (pkg.map[rootKey] || map[rootKey]) + lookupKey.substr(rootKey.length);
		baseKey = pkg.rootKey + '/';
	}

	state.importKey = importKey;
	state.baseKey = baseKey;
}

function resolvePackage(state: ResolveState) {
	const { importKey, manager, resolvedKey } = state;
	let otherPkg: Package | false | undefined | Promise<Package | false>;
	let name: string;
	let path: string;

	const match = importKey.match(rePackage);

	if(match) {
		name = match[1];
		path = match[3];
		otherPkg = manager.packageNameTbl[name];
	} else {
		otherPkg = manager.getPackage(resolvedKey);

		if(otherPkg) {
			name = otherPkg.name;
			path = resolvedKey.substr(otherPkg.rootKey.length);

			if(path == '/') path = '';
			if(otherPkg == state.pkg && path) return;
		}
	}

	if(otherPkg instanceof Package) {
		state.pkg = otherPkg;
		state.baseKey = otherPkg.rootKey + '/';
		state.importKey = (path! || otherPkg.main || 'index.js').replace(/^(\.?\/)?/, './');

		return otherPkg;
	}

	// Configuration for referenced package is not currently available.
	state.importation.missingPackageName = name!;
}

function inRegistry(loader: Loader, key: string) {
	return loader.registry[key] || loader.records[key];
}

function ifExists(loader: Loader, key: string) {
	// TODO: Fail for wrong MIME type (mainly html error messages).
	return loader.fetch(key, { method: 'HEAD' }).then((res) => decodeURI(res.url));
}

function ifExistsList(loader: Loader, list: string[], pos: number): Promise<string> {
	const key = list[pos];
	if(!key) return Promise.reject(new Error('Error fetching ' + list[0]));

	return ifExists(loader, list[pos]).catch(() => ifExistsList(loader, list, pos + 1));
}

function getFileLocations(
	loader: Loader,
	key: string,
	importation: Importation
) {
	const locations: string[] = [];
	const extensionList = importation.extensionList;
	let ext = key.substr(key.lastIndexOf('.') + 1);

	if((ext && loader.getDefaultPlugin(ext)) || !extensionList) {
		locations.push(key);
		return locations;
	}

	if(/\/$/.test(key)) key += 'index';

	while(1) {
		for(let ext of extensionList) {
			locations.push(key + '.' + ext);
		}

		if(/\/index$/.test(key)) break;

		key += '/index';
	}

	return locations;
}

export interface ResolveConfig {

	cdn?: (string | CDN)[];

	/** Suggested dependency versions, format is like in package.json. */
	dependencies?: { [name: string]: string };

	/** Ordered list of package.json field names for the main script. */
	mainFields?: string[];

	manager?: PackageManager;

}

export class ResolvePlugin implements LoaderPlugin {

	constructor(public loader: Loader, config?: ResolveConfig) {
		config = config || {};

		this.manager = config.manager || new PackageManager(config);

		const dependencies = config.dependencies || {};

		for(let name of keys(dependencies)) {
			const meta = this.manager.registerMeta(name);
			if(!meta.suggestedVersion) meta.suggestedVersion = dependencies[name];
		}
	}

	/** Check if a file exists. */

	checkFile(key: string, importation: Importation, sync: true): string;
	checkFile(key: string, importation: Importation, sync: false): Zalgo<string>;
	checkFile(
		key: string,
		importation: Importation,
		sync: boolean
	) {
		const loader = this.loader;

		if(inRegistry(loader, key)) return key;

		const locations = getFileLocations(loader, key, importation);

		// TODO: If result is not the first key, configure mappings.

		for(let key of locations) {
			if(inRegistry(loader, key)) return key;
		}

		if(sync) return key;

		if(importation.status.isImport && (importation.package || !rePackage.test(key))) {
			// The file is likely to exist (imported with an absolute address or naming
			// a package with metadata already loaded) and its contents are needed so fetch
			// and store them to avoid making another request later.

			return loader.fetch(locations[0]).then((res: FetchResponse) =>
				res.text().then((text: string) => {
					importation.sourceCode = text;
					return decodeURI(res.url);
				})
			).catch(() => ifExistsList(loader, locations, 1));
		}

		return ifExistsList(loader, locations, 0);
	}

	findPackage(packageName: string, basePkg: Package | false, baseKey: string) {
		let parsed = this.manager.packageNameTbl[packageName];

		if(parsed === void 0) {
			parsed = this.lockReady.then(() => fetchPackage(
				this.loader, this.manager,
				getRepoPaths(this.manager, basePkg && basePkg.name, baseKey),
				packageName
			));

			this.manager.packageNameTbl[packageName] = parsed;
		}

		return parsed;
	}

	setPlugin(resolvedKey: string, importation: Importation) {
		const loader = this.loader;
		const ext = loader.getExtension(resolvedKey);
		const plugin = loader.getDefaultPlugin(ext);

		if(plugin) {
			importation.extension = ext;
			importation.pluginStack = addPlugin(plugin, importation.pluginStack);
		}

		return resolvedKey;
	}

	resolveSync(importation: Importation) {
		const { loader, manager } = this;
		const { baseKey, importKey } = importation;

		const state: ResolveState = {
			baseKey: baseKey || '',
			count: 8,
			importation,
			importKey,
			loader,
			manager,
			pkg: (baseKey && manager.getPackage(baseKey)) || loader.package,
			resolvedKey: importKey
		};

		do {
			resolvePackageMaps(state);

			if(inRegistry(loader, state.importKey)) {
				state.resolvedKey = state.importKey;
				break;
			}
		} while(resolvePackage(state) && state.count);

		if(!state.count) {
			throw new Error('Too many redirections while resolving ' + importKey);
		}

		importation.package = state.pkg;

		return this.setPlugin(this.checkFile(state.resolvedKey, importation, true), importation);
	}

	resolve(importation: Importation): Zalgo<string> {
		const { loader, manager } = this;
		const baseKey = importation.baseKey || '';
		let resolvedKey: string;

		const tryPackage = (pkg?: Package | false) => {
			if(pkg) resolvedKey = loader.resolveSync(importation.importKey, baseKey, importation);

			return (importation.sourceCode ? resolvedKey :
				Promise.resolve(
					this.checkFile(resolvedKey, importation, false)
				).then(
					(resolvedKey) => this.setPlugin(resolvedKey, importation)
				)
			);
		};

		return fetchContainingPackage(this.loader, this.manager, baseKey).then((basePkg: Package | false) => {
			if(importation.status.isImport && basePkg && this.lockReady == emptyPromise) {
				// If this is the first import and a package configuration was
				// found in a directory containing or under the base address,
				// look for a lock file defining exact dependency versions.

				this.lockReady = fetchLock(this.loader, this.manager, basePkg, baseKey);
			}

			// Try synchronous resolve first. Should set missingPackageName
			// in importation if an unknown package is referenced.
			resolvedKey = loader.resolveSync(importation.importKey, baseKey, importation);

			const missingPackageName = importation.missingPackageName;

			return !!missingPackageName && this.findPackage(
				missingPackageName,
				basePkg,
				baseKey
			);
		}).then(tryPackage).catch((err: any) =>
			// If an imported package was never found,
			// nothing more can be done.
			importation.missingPackageName ? Promise.reject(err) :
				// Maybe a package was imported using its root path.
				fetchPackage(
					loader,
					manager,
					// No repository lookups.
					[{}],
					removeSlash(resolvedKey)
				).then((pkg) => pkg ? tryPackage(pkg) :
					Promise.reject(new Error('Error fetching ' + resolvedKey))
				)
		);
	}

	// A kludge, packages defined in bundles are registered with PackageManager here
	// but their contents handled in loader.built.

	built(specList: BuiltSpec[], baseKey: string) {
		const packageList: Package[] = [];

		for(let pkgSpec of specList) {
			const root = pkgSpec.root && URL.resolve(
				baseKey,
				pkgSpec.root
			);
			const pkg = pkgSpec.name == '_' ? this.loader.package : new Package(pkgSpec.name, root);
			pkg.version = pkgSpec.version;
			pkg.main = pkgSpec.main;
			pkg.map = pkgSpec.map || {};

			this.manager.registerPackage(pkg);
			packageList.push(pkg);
		}

		return packageList;
	}

	lockReady: Promise<void> = emptyPromise;

	manager: PackageManager;

	id?: string;

}

export const Resolve = pluginFactory('resolve', ResolvePlugin);
