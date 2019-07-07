import { URL, skipSlashes } from './URL';
import { Package } from './Package';
import { PackageManager, RepoKind } from './PackageManager';
import { features } from './platform';

export const nodeModules = '/node_modules/';

/** Valid npm package name. */
const reName = '[0-9a-z][-_.0-9a-z]*';

export const reVersion = /^(@[.0-9]+)?\/$/;

export const rePackage = new RegExp(
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

function semverMax(first: string | undefined, rest: string[], num = 0): string {
	if(!first) return semverMax(rest[0], rest, 1);

	let result = first.split('.');

	while(num < rest.length) {
		const other = rest[num++].split('.');
		const partCount = Math.min(result.length, other.length);
		let partNum = 0;

		while(partNum < partCount) {
			const part = result[partNum].replace(/^[ <=>~^]+ */, '');
			const otherPart = other[partNum++].replace(/^[ <=>~^]+ */, '');

			if(otherPart > part) result = other;
			if(otherPart < part) break;
		}

		if(partNum >= partCount && other.length > partCount) result = other;
	}

	return(result.join('.'));
}

export function getRootConfigPaths(baseKey: string) {
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

export function getRepoPaths(manager: PackageManager, basePkgName: string | false, baseKey: string) {
	let start = skipSlashes(baseKey, 0, 3);

	const resultPreferred: { isPreferred?: boolean, root: string, isCDN?: boolean }[] = [];
	const resultOther: { isPreferred?: boolean, root: string, isCDN?: boolean }[] = [];
	let next = baseKey.lastIndexOf('/');
	let end: number;

	function addRepo(len: number, suffix: string) {
		const root = baseKey.substr(0, len) + suffix;
		const kind = manager.repoTbl[root];
		(kind ? resultPreferred : resultOther).push({
			isPreferred: !!kind,
			root,
			isCDN: (kind == RepoKind.CDN)
		});
	}

	// List parent directories from caller path while it contains
	// more than 3 slashes (starting from beginning or including last
	// /node_modules/<name>/).
	do {
		end = next;
		next = baseKey.lastIndexOf('/', end - 1);

		const chunk = baseKey.substr(next, end - next + 1);
		if(
			basePkgName &&
			chunk.substr(1, basePkgName.length) == basePkgName &&
			reVersion.test(chunk.substr(basePkgName.length + 1))
		) {
			addRepo(next, '/');
		}

		if(chunk != nodeModules) addRepo(end, nodeModules);
	} while(end > start);

	resultOther.push({ isPreferred: true, root: manager.cdn, isCDN: true });

	return resultPreferred.concat(resultOther);
}

export function parsePackage(manager: PackageManager, rootKey: string, data: string, name?: string) {
	const json = JSON.parse(data);
	name = name || json.name;
	if(!name) throw(new Error('Nameless package ' + rootKey));

	const version = json.version;

	const meta = manager.registerMeta(name);
	meta.lockedVersion = version;

	if(meta.suggestedVersion) {
		rootKey = rootKey.replace('@' + meta.suggestedVersion, '@' + version);
	}

	const pkg = new Package(name, rootKey);
	pkg.version = version;
	pkg.main = json.main || 'index.js';

	const browser = !features.isNode && json.browser;

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

	for(let dep of Object.keys(json.dependencies || {})) {
		const depMeta = manager.registerMeta(dep);
		const versionList = json.dependencies[dep].split(/ *\|\| *| +(- +)?/);

		depMeta.suggestedVersion = semverMax(depMeta.suggestedVersion, versionList);
	}

	return pkg;
}
