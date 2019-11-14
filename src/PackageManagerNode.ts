import { URL, skipSlashes } from './URL';
import { Package } from './Package';
import { PackageManager, RepoKind } from './PackageManager';
import { keys } from './platform';

export const nodeModules = '/node_modules/';

/** Valid npm package name. */
const reName = '[0-9a-z][-_.0-9a-z]*';
const reTag = /^([A-UW-Za-uw-z]|[Vv][-_A-Za-z])[-._0-9A-Za-z]*$/;

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

export function removeSlash(key: string) {
	return key.replace(/\/$/, '');
}

function parserSemverPart(part: string) {
	part = part.replace(/^[ <=>~^]+ *v?/, '');

	if(!part || part == 'x') return Infinity;
	return +part;
}

function semverMax(first: string | undefined, rest: string[], num = 0): string {
	const latest = 'latest';
	let tag: string | undefined;

	while((!first || first.match(reTag)) && num < rest.length) {
		if(!tag && first != latest) tag = first;
		first = rest[num++];
	}

	let result = first || '';
	let resultParts = result.split('.');

	while(num < rest.length) {
		const other = rest[num++];
		if(other.match(reTag)) {
			if(!tag && other != latest) tag = other;
			continue;
		}

		const otherParts = other.split('.');
		const partCount = Math.min(resultParts.length, otherParts.length);
		let partNum = 0;

		while(partNum < partCount) {
			const part = parserSemverPart(resultParts[partNum]);
			const otherPart = parserSemverPart(otherParts[partNum++]);

			if(otherPart > part) result = other;
			if(otherPart < part) break;
		}

		if(partNum >= partCount && other.length > partCount) result = other;
	}

	return(result || tag || latest);
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

	if(meta.suggestedVersion) {
		rootKey = rootKey.replace('@' + meta.suggestedVersion, '@' + version);
	}

	const pkg = new Package(name, rootKey);
	pkg.version = version;

	for(let field of manager.config.mainFields || ['main']) {
		const spec = json[field];

		if(field == 'browser' && typeof spec == 'object') {
			// Use browser equivalents of packages and files.

			for(let key of keys(spec)) {
				const src = URL.resolve(rootKey + '/', key);
				const dst = spec[key] || '@empty';

				if(rePackage.test(key)) {
					pkg.map[key] = dst;
				}

				pkg.map[src] = dst;
				pkg.map[src.replace(/\.([jt]sx?)$/, '')] = dst;
			}
		} else if(spec && !pkg.main) {
			pkg.main = spec;
			break;
		}
	}

	pkg.main = pkg.main || 'index.js';

	for(let depTbl of [json.dependencies, json.peerDependencies]) {
		for(let dep of Object.keys(depTbl || {})) {
			const depMeta = manager.registerMeta(dep);
			let version = depTbl[dep];

			if(version.match(/^([<=>~^]*v?[.0-9x]+( *\|\| *| +(- +)?|$))+$/) || version.match(reTag)) {
				depMeta.suggestedVersion = semverMax(
					depMeta.suggestedVersion,
					version.split(/ *\|\| *| +(?:- +)?/)
				);
			} else if(version.match(/^file:/)) {
				pkg.map[dep] = removeSlash(version.substr(5));
			}
		}
	}

	return pkg;
}
