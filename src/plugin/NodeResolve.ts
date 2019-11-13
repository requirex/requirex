import { URL, getDir } from '../URL';
import { DepRef } from '../Record';
import { Package } from '../Package';
import { PackageManager, RepoKind } from '../PackageManager';
import { rePackage, getRootConfigPaths, getRepoPaths, parsePackage, nodeModules } from '../PackageManagerNode';
import { emptyPromise, makeTable, nodeRequire, rootPathLookup, keys } from '../platform';
import { FetchResponse } from '../fetch';
import { Loader, LoaderPlugin } from '../Loader';

interface PackageLock {
	name: string;
	version: string;
	lockfileVersion: number;
	dependencies?: {
		[name: string]: {
			version: string;
			integrity?: string;
			resolved?: string;
			dev?: boolean;
			requires?: { [name: string]: string };
		}
	};
}

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

function ifExists(loader: Loader, key: string) {
	// TODO: Fail for wrong MIME type (mainly html error messages).
	return loader.fetch(key, { method: 'HEAD' }).then((res) => decodeURI(res.url));
}

function ifExistsList(loader: Loader, list: string[], pos: number): Promise<string> {
	const key = list[pos];
	if(!key) return Promise.reject(new Error('Error fetching ' + list[0]));

	return ifExists(loader, list[pos]).catch(() => ifExistsList(loader, list, pos + 1));
}

function parseFetchedPackage(
	manager: PackageManager,
	rootKey: string,
	fetched: Promise<FetchResponse>,
	name?: string
) {
	let redirKey: string;

	const parsed = fetched.then((res: FetchResponse) => {
		redirKey = res.url;
		return res.text();
	}).then((data: string) => {
		try {
			const pkg = parsePackage(manager, decodeURI(getDir(redirKey)), data, name)
			manager.registerPackage(pkg, rootKey);
			return pkg;
		} catch(err) {
			console.error('Error parsing ' + redirKey);
			console.error(err);
			throw err;
		}
	}).catch(() => {
		manager.packageConfTbl[rootKey] = false;
		return Promise.reject(false);
	});

	manager.packageConfTbl[rootKey] = parsed;
	return parsed;
}

function fetchPackage(
	loader: Loader,
	repoList: { isPreferred?: boolean, root?: string, isCDN?: boolean }[],
	name: string,
	repoNum = 0
): Promise<Package | false> {
	const manager = loader.manager;
	const repo = repoList[repoNum];
	const repoKey = repo.root || '';
	const meta = manager.registerMeta(name);
	let version = '';

	if(repo.isCDN) {
		version = meta.suggestedVersion || 'latest';
		meta.suggestedVersion = version;
		version = '@' + (meta.lockedVersion || version);
	}

	let parsed = manager.packageConfTbl[repoKey + name + version];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		const jsonKey = repoKey + name + version + '/package.json';
		const fetched = repo.isPreferred ? loader.fetch(jsonKey) : (
			ifExists(loader, jsonKey).then((key: string) => {
				// A repository was found so look for additional packages there
				// before other addresses.
				if(repoKey) manager.repoTbl[repoKey] = repo.isCDN ? RepoKind.CDN : RepoKind.NORMAL;
				return loader.fetch(key);
			})
		);

		parsed = parseFetchedPackage(manager, repoKey + name + version, fetched, name);
	}

	return Promise.resolve<Package | false>(parsed).catch(
		() => ++repoNum < repoList.length ? fetchPackage(loader, repoList, name, repoNum) : false
	);
}

function tryFetchPackageRoot(loader: Loader, key: string, getNext: () => string | undefined) {
	const manager = loader.manager;
	let parsed = manager.packageConfTbl[key];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		parsed = parseFetchedPackage(manager, key, loader.fetch(key + '/package.json'));
	} else if(parsed instanceof Package) {
		manager.packageRootTbl[key] = parsed;
		return Promise.resolve(parsed);
	}

	const result = parsed.catch(() => {
		const nextKey = getNext();
		// On error always try the next possible (parent) directory.
		return nextKey ? manager.packageRootTbl[nextKey] : false;
	}).then(
		(pkg: false | Package) => manager.packageRootTbl[key] = pkg
	);

	manager.packageRootTbl[key] = result;
	return result;
}

/** Get information about package containing the given address.
  * Try to find package.json files in parent paths. */

function fetchContainingPackage(loader: Loader, baseKey: string) {
	const manager = loader.manager;
	const packageRootTbl = manager.packageRootTbl;
	const rootConfigPaths = getRootConfigPaths(baseKey);
	let pkg: undefined | false | Package | Promise<false | Package>;

	// Get common parent directory for caller and another known path
	// elsewhere in the package. It's likely to be the root.
	const bestPos = URL.common(baseKey, loader.baseURL || baseKey);
	const bestGuess = bestPos && baseKey.substr(0, bestPos - 1);
	let key = '';
	let best: string | undefined;

	const count = rootConfigPaths.length;

	// Look for a package or a promise.

	for(let num = 0; pkg === void 0 && num < count; ++num) {
		key = rootConfigPaths[num];
		pkg = packageRootTbl[key];
		if(key == bestGuess) best = key;
	}

	// If existence of a package containing baseKey is unknown, look for
	// package.json files in parent directories.

	if(pkg === void 0 && count) {
		if(!best) best = key;

		// Try the most likely root dir first.
		pkg = tryFetchPackageRoot(loader, best, () => {
			/** Result for this promise comes from a parent dir. */
			let afterBest: string | undefined;

			// Try all possible root dirs in parallel.
			for(let num = 0; num < count; ++num) {
				const key = rootConfigPaths[num];
				const nextKey: string | undefined = rootConfigPaths[num + 1];

				if(key == best) {
					// This promise tried the most likely root dir but failed,
					// so its result comes from the parent dir.
					afterBest = nextKey;
				} else if(packageRootTbl[key] === void 0) {
					// Try a possible root dir and store the resulting
					// promise to avoid repeated attempts.
					tryFetchPackageRoot(loader, key, () => nextKey);
				}
			}

			return afterBest;
		}).catch(
			() => packageRootTbl[rootConfigPaths[0]]
		);
	}

	return Promise.resolve<Package | false>(pkg || false);
}

function fetchLock(loader: Loader, pkg: Package) {
	const manager = loader.manager;

	return loader.fetch(pkg.root + '/npm-shrinkwrap.json').catch(
		() => loader.fetch(pkg.root + '/package-lock.json')
	).then(
		(res) => res.text()
	).then((data: string) => {
		const json: PackageLock = JSON.parse(data);

		if(
			json.name != pkg.name ||
			json.version != pkg.version ||
			json.lockfileVersion != 1
		) return;

		const depTbl = json.dependencies || {};

		for(let name of keys(depTbl)) {
			const depVersion = depTbl[name].version;

			if(depVersion) {
				const meta = manager.registerMeta(name);
				meta.lockedVersion = depVersion;
			}
		}
	}).catch(() => { });
}

function inRegistry(loader: Loader, key: string) {
	return loader.registry[key] || loader.records[key];
}

/** Check if a file exists. */

function checkFile(loader: Loader, key: string, baseKey: string, ref?: DepRef, isPackage?: boolean) {
	let baseExt: string | undefined;
	let name: string;

	if(inRegistry(loader, key)) return key;

	let pos = key.lastIndexOf('.') + 1;
	let ext = key.substr(pos);
	const origKey = key;

	// Add default extension if file has no known extension.
	if(!(pos && loader.plugins[ext]) && !inRegistry(loader, key)) {
		pos = key.length + 1;
		ext = (ref && ref.defaultExt) || 'js';
		key += '.' + ext;
	}

	const list: string[] = [];

	if(key.charAt(key.lastIndexOf('/') + 1) != '.') {
		list.push(key);

		if(ext == 'js') {
			baseExt = baseKey.substr(baseKey.lastIndexOf('.') + 1);

			if(baseExt == 'ts') {
				name = key.substr(0, pos) + 'ts';
				list.push(name);
				list.push(name + 'x');
			}
		}

		if(ext == 'ts') {
			list.push(key + 'x');
		}
	}

	if(ext == 'js') {
		name = key.replace(/\/?(\.js)?$/, '/index');
		list.push(name + '.js');
		if(baseExt == 'ts') list.push(name + '.ts');
	}

	// TODO: If result is not the first key, configure mappings.

	for(let key of list) {
		if(inRegistry(loader, key)) return key;
	}

	if(!ref) return origKey;

	if(ref.isImport && (!isPackage || ref.package)) {
		return loader.fetch(list[0]).then((res: FetchResponse) =>
			res.text().then((text: string) => {
				ref.sourceCode = text;
				return decodeURI(res.url);
			})
		).catch(() => ifExistsList(loader, list, 1));
	}

	return ifExistsList(loader, list, 0);
}

/** Node.js module lookup plugin. */

export class NodeResolve implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolveSync(key: string, baseKey: string, ref?: DepRef) {
		const loader = this.loader;
		const manager = loader.manager;
		const map = loader.package.map;
		let pkg = manager.getPackage(baseKey) || loader.package;
		let resolvedKey = key;
		let subKey: string | undefined;
		let mappedKey: string | undefined;
		let lookupKey: string | undefined;
		let count = 8;
		let name: string;
		let path: string;

		do {
			while(1) {
				lookupKey = key;
				subKey = rootPathLookup(lookupKey, pkg.map) || rootPathLookup(lookupKey, map);

				if(!subKey) {
					resolvedKey = URL.resolve(baseKey, key);
					lookupKey = resolvedKey;
					// TODO: Handle default extensions and possible wildcards.
					subKey = rootPathLookup(lookupKey, pkg.map) || rootPathLookup(lookupKey, map);
				}

				if(!subKey) break;

				mappedKey = (pkg.map[subKey] || map[subKey]) + lookupKey.substr(subKey.length);

				if(mappedKey == key || !--count) break;

				key = mappedKey;
				baseKey = pkg.root + '/';
			}

			if(inRegistry(loader, key)) {
				resolvedKey = key;
				break;
			}

			let otherPkg: Package | false | undefined | Promise<Package | false>;

			const match = key.match(rePackage);
			if(match) {
				name = match[1];
				path = match[3];
				otherPkg = manager.packageNameTbl[name];
			} else {
				otherPkg = manager.getPackage(resolvedKey);
				if(!otherPkg) break;
				name = otherPkg.name;
				path = resolvedKey.substr(otherPkg.root.length);
				if(path == '/') path = '';
				if(otherPkg == pkg && path) break;
			}

			if(!(otherPkg instanceof Package)) {
				// Configuration for referenced package is not currently available.
				if(ref) {
					if(isInternal[name]) {
						resolvedKey = name;
						pkg = loader.package;
						ref.format = 'node';
					} else {
						ref.pendingPackageName = name;
					}
				}

				break;
			}

			pkg = otherPkg;
			baseKey = otherPkg.root + '/';
			key = (path || otherPkg.main || 'index.js').replace(/^(\.?\/)?/, './');
		} while(--count);

		if(!count) {
			throw new Error('Too many redirections while resolving ' + key);
		}

		if(ref) ref.package = pkg;

		return checkFile(loader, resolvedKey, baseKey) as string;
	}

	resolve(key: string, baseKey: string, ref: DepRef = {}): Promise<string> {
		const loader = this.loader;
		const manager = loader.manager;
		let resolvedKey: string;
		let packageName: string | undefined;

		// Find a package containing baseKey, to get browser path and
		// package mappings and versions.
		const result = fetchContainingPackage(loader, baseKey).then((basePkg: Package | false) => {
			if(ref.isImport && basePkg && this.lockReady == emptyPromise) {
				// If running import for the first time and a package
				// configuration was found in a directory containing or under
				// the base address, look for a lock file defining the exact
				// versions of all dependencies.

				const origin = loader.baseURL || loader.firstParent || baseKey;
				const prefix = URL.common(origin, basePkg.root + '/');

				if(
					prefix > 8 &&
					(
						prefix >= origin.length ||
						prefix >= basePkg.root.length
					) &&
					basePkg.root.substr(prefix - 1).indexOf(nodeModules) < 0
				) {
					this.lockReady = fetchLock(loader, basePkg);
				}
			}

			resolvedKey = loader.resolveSync(key, baseKey, ref);
			const parentPackageName = basePkg && basePkg.name;
			let parsed: Package | false | undefined | Promise<Package | false | undefined>;

			packageName = ref.pendingPackageName;

			if(packageName) {
				parsed = manager.packageNameTbl[packageName];

				if(parsed === void 0) {
					parsed = this.lockReady.then(() => fetchPackage(
						loader,
						getRepoPaths(manager, parentPackageName, baseKey),
						packageName!
					));

					manager.packageNameTbl[packageName] = parsed as Promise<Package | false>;
				}
			}

			return parsed;
		}).then((pkg: Package | false | undefined) => {
			const plugin = ref.format && loader.plugins[ref.format];

			if(plugin) {
				if(plugin.resolve) return plugin.resolve(key, baseKey, ref);
				if(plugin.resolveSync) return plugin.resolveSync(key, baseKey, ref);
			}

			if(pkg) resolvedKey = loader.resolveSync(key, baseKey, ref);
			if(ref.sourceCode) return resolvedKey;

			return checkFile(loader, resolvedKey, baseKey, ref, rePackage.test(key));
		}).catch((err: any) => {
			if(packageName) return Promise.reject(err);

			// Handle importing a package using its root path.

			return fetchPackage(
				loader,
				[{}],
				resolvedKey.replace(/\/$/, '')
			).then((pkg: Package | false | undefined) => {
				if(!pkg) return Promise.reject(new Error('Error fetching ' + resolvedKey));

				resolvedKey = loader.resolveSync(key, baseKey, ref);
				return checkFile(loader, resolvedKey, baseKey, ref);
			});
		}).then((resolvedKey: string) => !ref.pluginArg ? resolvedKey :
			// Simulate Dojo loader, call plugin normalize hook.
			this.loader.import(resolvedKey).then((plugin) => {
				ref.plugin = plugin;

				if(!plugin.normalize) return resolvedKey;

				return plugin.normalize(
					ref.pluginArg,
					(key: string) => this.loader.resolveSync(key, baseKey)
				);
			}).catch((err) => {
				console.error('Error in custom loader plugin ' + key);
				console.error(err);
				return resolvedKey;
			}).then((pluginKey: string) => pluginKey == resolvedKey ? resolvedKey :
				checkFile(loader, pluginKey, baseKey, ref)
			)
		);

		return result;
	}

	lockReady: Promise<void> = emptyPromise;

}
