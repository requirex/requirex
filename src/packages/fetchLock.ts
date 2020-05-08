import { URL } from '../platform/URL';
import { emptyPromise, keys } from '../platform/util';
import { Loader } from '../Loader';
import { PackageManager } from './PackageManager';
import { nodeModules } from './PackageManagerNode';
import { Package } from './Package';

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

export function fetchLock(loader: Loader, manager: PackageManager, basePkg: Package, baseKey: string) {
	const origin = loader.config.baseURL || loader.config.libraryBaseKey || baseKey;
	const prefixLen = URL.common(origin, basePkg.rootKey + '/');

	if(
		prefixLen < 9 ||
		(
			prefixLen < origin.length &&
			prefixLen < basePkg.rootKey.length
		) ||
		basePkg.rootKey.substr(prefixLen - 1).indexOf(nodeModules) >= 0
	) {
		return emptyPromise;
	}

	return loader.fetch(basePkg.rootKey + '/npm-shrinkwrap.json').catch(
		() => loader.fetch(basePkg.rootKey + '/package-lock.json')
	).then(
		(res) => res.text()
	).then((data: string) => {
		const json: PackageLock = JSON.parse(data);

		if(
			json.name != basePkg.name ||
			json.version != basePkg.version ||
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
