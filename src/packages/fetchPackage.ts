import { getDir } from '../platform/util';
import { FetchResponse } from '../platform/fetch';
import { Loader } from '../Loader';
import { PackageManager, CDN } from './PackageManager';
import { parsePackage } from './PackageManagerNode';
import { Package } from '../packages/Package';

function ifExists(loader: Loader, key: string) {
	// TODO: Fail for wrong MIME type (mainly html error messages).
	return loader.fetch(key, { method: 'HEAD' }).then((res) => decodeURI(res.url));
}

export function fetchPackage(
	loader: Loader,
	manager: PackageManager,
	repoList: { isPreferred?: boolean, root?: string, cdn?: CDN }[],
	name: string,
	repoNum = 0
): Promise<Package | false> {
	const repo = repoList[repoNum];
	const repoKey = repo.root || '';
	let rootKey: string;

	if(repo.cdn) {
		const meta = manager.registerMeta(name);
		const version = meta.suggestedVersion || 'latest';

		meta.suggestedVersion = version;

		if(repo.cdn.resolve) {
			rootKey = repo.cdn.resolve(name, (meta.lockedVersion || version), repo.cdn.root);
		} else {
			rootKey = repo.cdn.root + name + '@' + (meta.lockedVersion || version);
		}
	} else {
		rootKey = repoKey + name;
	}

	let parsed = manager.packageConfTbl[rootKey];

	if(parsed === false) {
		parsed = Promise.reject(parsed);
	} else if(!parsed) {
		const jsonKey = rootKey + '/package.json';
		const fetched = repo.isPreferred ? loader.fetch(jsonKey) : (
			ifExists(loader, jsonKey).then((key: string) => {
				// A repository was found so look for additional packages there
				// before other addresses.
				if(repoKey) {
					manager.repoTbl[repoKey] = repo.cdn || true;
				}

				return loader.fetch(key);
			})
		);

		parsed = parseFetchedPackage(manager, rootKey, fetched, name);
	}

	return Promise.resolve<Package | false>(parsed).catch(
		() => ++repoNum < repoList.length ? fetchPackage(loader, manager, repoList, name, repoNum) : false
	);
}

export function parseFetchedPackage(
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
