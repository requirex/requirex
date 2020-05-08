import { URL } from '../platform/URL';
import { Zalgo } from '../platform/util';
import { Loader } from '../Loader';
import { PackageManager } from './PackageManager';
import { getRootConfigPaths } from './PackageManagerNode';
import { parseFetchedPackage } from './fetchPackage';
import { Package } from './Package';

function tryFetchPackageRoot(loader: Loader, manager: PackageManager, key: string, getNext: () => string | undefined) {
	let parsed = manager.packageConfTbl[key];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		parsed = parseFetchedPackage(manager, key, loader.fetch(key + '/package.json'));
	} else if(parsed instanceof Package) {
		manager.packageRootTbl[key] = parsed;
		return Promise.resolve(parsed);
	}

	const result = parsed.catch((): Zalgo<Package | false | undefined | ''> => {
		const nextKey = getNext();
		// On error always try the next possible (parent) directory.
		return nextKey && manager.packageRootTbl[nextKey];
	}).then((pkg) => manager.packageRootTbl[key] = pkg || false);

	manager.packageRootTbl[key] = result;
	return result;
}

/** Get information about package containing the given address.
  * Try to find package.json files in parent paths. */

export function fetchContainingPackage(loader: Loader, manager: PackageManager, baseKey: string) {
	const packageRootTbl = manager.packageRootTbl;
	const rootConfigPaths = getRootConfigPaths(baseKey);
	let pkg: undefined | false | Package | Promise<false | Package>;

	// Get common parent directory for caller and another known path
	// elsewhere in the package. It's likely to be the root.
	const bestPos = URL.common(baseKey, loader.config.baseURL || baseKey);
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
		pkg = tryFetchPackageRoot(loader, manager, best, () => {
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
					tryFetchPackageRoot(loader, manager, key, () => nextKey);
				}
			}

			return afterBest;
		}).catch(
			() => packageRootTbl[rootConfigPaths[0]] || false
		);
	}

	return Promise.resolve<Package | false>(pkg || false);
}
