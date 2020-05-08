import { Zalgo } from '../platform/util';
import { Package } from './Package';
import { ResolveConfig } from '../stages/Resolve';

export interface PackageMeta {
	lockedVersion?: string;
	suggestedVersion?: string;
}

export interface CDN {

	/** CDN root address including final slash. */
	root: string;

	/** @param packageName Name of package to import.
	  * @param version Package version with semver syntax, eg. "1.0" or "latest".
	  * @param root CDN root address including final slash.
	  *
	  * @return Fully resolved URL address. */
	resolve?(packageName: string, version?: string, root?: string): string;

}

export function rootPathLookup<Type>(
	key: string,
	rootTbl: {[key: string]: Type},
	filter?: (result: Type) => boolean | undefined
) {
	let end = key.length;

	do {
		const rootKey = key.substr(0, end);
		const item = rootTbl[rootKey];

		if(filter ? filter(item) : item) return rootKey;
	} while(end && (end = key.lastIndexOf('/', end - 1)) >= 0);
}

export class PackageManager {

	constructor(config?: ResolveConfig) {
		if(!config) return;

		if(config.mainFields) {
			this.mainFields = config.mainFields;
		}

		for(let cdn of config.cdn || []) {
			if(typeof cdn == 'string') cdn = { root: cdn };

			this.registerCDN(cdn);
		}
	}

	registerCDN(cdn: CDN) {
		this.repoTbl[cdn.root] = cdn;
		this.cdnList.push(cdn);
	}

	registerMeta(name: string) {
		return this.packageMetaTbl[name] || (this.packageMetaTbl[name] = {});
	}

	registerPackage(pkg: Package, rootKey?: string) {
		this.packageNameTbl[pkg.name] = pkg;
		this.packageConfTbl[pkg.rootKey] = pkg;
		this.packageRootTbl[pkg.rootKey] = pkg;

		if(rootKey) {
			this.packageConfTbl[rootKey] = pkg;
			this.packageRootTbl[rootKey] = pkg;
		}

		const meta = this.registerMeta(pkg.name);

		if(!meta.lockedVersion) meta.lockedVersion = pkg.version;
	}

	/** Get metadata for package containing an address.
	  *
	  * @return Metadata if found and has finished loading, otherwise undefined. */

	getPackage(resolvedKey: string) {
		const rootKey = rootPathLookup(
			resolvedKey,
			this.packageRootTbl,
			(pkg) => pkg && pkg instanceof Package
		);

		if(rootKey) return this.packageRootTbl[rootKey] as Package;
	}

	/** Map package name to configuration metadata. */
	packageMetaTbl: { [name: string]: PackageMeta } = {};

	/** Map package name to package configuration or promise for one waiting to load. */
	packageNameTbl: { [name: string]: Zalgo<Package | false> | undefined } = {};

	/** Map package root path to configuration or promise for one waiting to load. */
	packageConfTbl: { [resolvedRoot: string]: Zalgo<Package | false> | undefined } = {};

	/** Map resolved keys to containing packages (keys not corresponding to a package root
	  * resolve to the same result as their parent directory does). */
	packageRootTbl: { [resolvedRoot: string]: Zalgo<Package | false> | undefined } = {};

	/** Table of known repository root addresses. */
	repoTbl: { [resolvedPath: string]: CDN | true | undefined } = {}

	/** Ordered list of package.json field names for the main script. */
	mainFields: string[] = ['main'];

	cdnList: CDN[] = [];

}
