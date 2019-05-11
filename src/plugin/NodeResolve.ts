import { URL, skipSlashes } from '../URL';
import { DepRef } from '../Record';
import { Package } from '../Package';
import { fetch, FetchResponse } from '../fetch';
import { Loader, LoaderConfig, getDir } from '../LoaderBase';

const emptyPromise = Promise.resolve();
const nodeModules = '/node_modules/';

// Relative path.
const reRelative = /^\.\.?(\/|$)/;
// Absolute URL.
// const reAbsolute = /^[a-z]+:\/\//;
// Valid npm package name.
const reName = '[0-9a-z][-_.0-9a-z]*';
const rePackage = new RegExp(
	// Package name with possible scope.
	'^(' + (
		// Package scope.
		'(@' + reName + '\/)?' +
		// Package name.
		reName
	) + ')' +
	// Path inside package.
	'(\/.*)?$'
);

const isInternal: { [key: string]: boolean } = {};

for(let key of 'assert buffer crypto fs http https module net os path stream url util zlib'.split(' ')) {
	isInternal[key] = true;
}

function getRootConfigPaths(baseKey: string) {
	let start = skipSlashes(baseKey, baseKey.lastIndexOf(nodeModules), 3);

	const result: string[] = [];
	let end = baseKey.length;

	// List parent directories from caller path while it contains
	// more than 3 slashes (starting from beginning or including last
	// /node_modules/<name>/).
	do {
		end = baseKey.lastIndexOf('/', end - 1);
		result.push(baseKey.substr(0, end));
	} while(end > start);

	return result;
}

export function getRepoPaths(loader: Loader, basePkgName: string, baseKey: string) {
	let start = skipSlashes(baseKey, 0, 3);

	const resultPreferred: { preferred?: boolean, root: string }[] = [];
	const resultOther: { preferred?: boolean, root: string }[] = [];
	let next = baseKey.lastIndexOf('/');
	let end: number;

	// List parent directories from caller path while it contains
	// more than 3 slashes (starting from beginning or including last
	// /node_modules/<name>/).
	do {
		end = next;
		next = baseKey.lastIndexOf('/', end - 1);

		const chunk = baseKey.substr(next, end - next + 1);
		if(chunk != nodeModules) {
			let root = '';
			if(basePkgName && chunk.substr(1, basePkgName.length) == basePkgName) {
				root = baseKey.substr(0, next);
			} else {
				root = baseKey.substr(0, end) + nodeModules;
			}
			const preferred = loader.repoTbl[root];
			(preferred ? resultPreferred : resultOther).push({ preferred, root });
		}
	} while(end > start);

	resultOther.push({ preferred: true, root: 'https://cdn.jsdelivr.net/npm/' });

	return resultPreferred.concat(resultOther);
}

function parsePackage(rootKey: string, data: string, name?: string) {
	const json = JSON.parse(data);
	const pkg = new Package(name || json.name, rootKey);

	pkg.version = json.version;
	pkg.main = json.main || 'index.js';
	const browser = json.browser;

	// TODO: Handle dependency versions and the browser field.

	if(typeof browser == 'string') {
		// Use browser entry point.
		pkg.main = browser;
	} else if(typeof browser == 'object') {
		// Use browser equivalents of packages and files.

		for(let key in browser) {
			if(!browser.hasOwnProperty(key)) continue;

			const src = URL.resolve(rootKey + '/', key);
			const dst = browser[key] || '@empty';

			const match = key.match(rePackage);
			if(match) {
				pkg.map[key] = dst;
			}

			pkg.map[src] = dst;
			pkg.map[src.replace(/\.([jt]sx?)$/, '')] = dst;
		}
	}

	return pkg;
}

function ifExists(key: string) {
	// TODO: Fail for wrong MIME type (mainly html error messages).
	return fetch(key, { method: 'HEAD' }).then((res) => res.url);
}

function parseFetchedPackage(
	loader: Loader,
	rootKey: string,
	fetched: Promise<FetchResponse>,
	name?: string
) {
	let redirKey: string;

	const parsed = fetched.then((res: FetchResponse) => {
		redirKey = getDir(res.url);
		return res.text();
	}).then((data: string) => {
		const pkg = parsePackage(redirKey, data, name)
		loader.packageConfTbl[rootKey] = pkg;
		loader.packageConfTbl[redirKey] = pkg;
		loader.packageRootTbl[rootKey] = pkg;
		loader.packageRootTbl[redirKey] = pkg;
		return pkg;
	}).catch(() => {
		loader.packageConfTbl[rootKey] = false;
		return Promise.reject(false);
	});

	loader.packageConfTbl[rootKey] = parsed;
	return parsed;
}

function fetchPackage(
	loader: Loader,
	repoList: { preferred?: boolean, root: string }[],
	name: string,
	repoNum?: number
): Promise<Package | false> {
	repoNum = repoNum || 0;
	const repo = repoList[repoNum];
	const repoKey = repo.root;

	let parsed = loader.packageConfTbl[repoKey + name];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		const jsonKey = repoKey + name + '/package.json';
		const fetched = repo.preferred ? fetch(jsonKey) : ifExists(jsonKey).then((key: string) => {
			// A repository was found so look for additional packages there
			// before other addresses.
			loader.repoTbl[repoKey] = true;
			return fetch(key);
		});

		parsed = parseFetchedPackage(loader, repoKey + name, fetched, name);
	}

	return Promise.resolve<Package | false>(parsed).catch(
		() => ++repoNum! < repoList.length ? fetchPackage(loader, repoList, name, repoNum) : false
	);
}

function tryFetchPackageRoot(loader: Loader, key: string, getNext: () => string | undefined) {
	let parsed = loader.packageConfTbl[key];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		parsed = parseFetchedPackage(loader, key, loader.fetch(key + '/package.json'));
	} else if(parsed instanceof Package) {
		loader.packageRootTbl[key] = parsed;
		return Promise.resolve(parsed);
	}

	const result = parsed.catch(() => {
		const nextKey = getNext();
		// On error always try the next possible (parent) directory.
		return nextKey ? loader.packageRootTbl[nextKey] : false;
	}).then(
		(pkg: false | Package) => loader.packageRootTbl[key] = pkg
	);

	loader.packageRootTbl[key] = result;
	return result;
}

function fetchContainingPackage(loader: Loader, baseKey: string) {
	const packageRootTbl = loader.packageRootTbl;
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

function inRegistry(loader: Loader, key: string) {
	if(loader.registry[key] || loader.records[key]) return Promise.resolve(key);
}

/** Check if a file exists. */

function checkFile(loader: Loader, key: string, importKey: string, ref: DepRef) {
	const other = (key.match(/\.ts$/) ?
		// For .ts files also try .tsx.
		key + 'x' :
		// For .js files also try /index.js.
		key.replace(/\/?(\.js)?$/, '/index.js')
	);

	let result: string;

	// TODO: If inRegistry(other) or ifExists(other) then store it in ref,
	// for adding in package configuration.
	return (inRegistry(loader, key) ||
		inRegistry(loader, other) ||
		(!ref.isImport || !reRelative.test(importKey) ? ifExists(key) :
			loader.fetch(key).then((res: FetchResponse) => {
				result = res.url;
				return res.text();
			}).then((text: string) => {
				ref.sourceCode = text;
				return result;
			})
		).catch(() => ifExists(other))
	);
}

/** Node.js module lookup plugin. */

export class NodeResolve extends Loader {

	// constructor(config?: LoaderConfig) {}

	resolveSync(key: string, baseKey?: string, ref?: DepRef) {
		let pkg = this.getPackage(baseKey!) || this.package;
		let resolvedKey = key;
		let mappedKey: string;
		let count = 8;

		do {
			while(1) {
				mappedKey = pkg.map[key];

				if(!mappedKey) {
					resolvedKey = URL.resolve(baseKey!, key);
					// TODO: Handle default extensions and possible wildcards.
					mappedKey = pkg.map[resolvedKey];
				}

				if(mappedKey && --count) {
					key = mappedKey;
					baseKey = pkg.root + '/';
				} else break;
			}

			if(inRegistry(this, key)) {
				resolvedKey = key;
				break;
			}

			const match = key.match(rePackage);
			if(!match) break;

			const name = match[1];
			const otherPkg = this.packageNameTbl[name];

			if(!(otherPkg instanceof Package)) {
				// Configuration for referenced package is not currently available.
				if(ref) {
					ref.pendingPackageName = name;
					if(isInternal[name]) {
						pkg = this.package;
						ref.format = 'node';
					}
				}

				break;
			}

			pkg = otherPkg;
			baseKey = otherPkg.root + '/';
			key = (match[3] || otherPkg.main || 'index.js').replace(/^(\.?\/)?/, './');
		} while(--count);

		if(!count) {
			throw new Error('Too many redirections while resolving ' + key);
		}

		if(ref) {
			ref.package = pkg;
		}

		return resolvedKey;
	}

	resolve(key: string, baseKey: string, ref: DepRef = {}): Promise<string> {
		let resolvedKey: string;
		let packageName: string | undefined;

		// Find a package containing baseKey, to get browser path and
		// package mappings and versions.
		const result = fetchContainingPackage(this, baseKey).then((basePkg: Package | false) => {
			resolvedKey = this.resolveSync(key, baseKey, ref);
			const parentPackageName = basePkg ? basePkg.name : '';
			let parsed: Package | false | undefined | Promise<Package | false | undefined>;

			packageName = ref.pendingPackageName;

			if(packageName && ref.format != 'node') {
				parsed = this.packageNameTbl[packageName];

				if(parsed === void 0) {
					parsed = fetchPackage(
						this,
						getRepoPaths(this, parentPackageName, baseKey),
						packageName
					);

					this.packageNameTbl[packageName!] = parsed as Promise<Package | false>;
				}
			}

			return parsed;
		}).then((pkg: Package | false | undefined) => {
			if(ref.format == 'node') return packageName!;

			if(pkg) {
				this.packageNameTbl[packageName!] = pkg;
				resolvedKey = this.resolveSync(key, baseKey, ref);
			}

			return checkFile(this, resolvedKey, key, ref);
		});

		return result;
	}

}
