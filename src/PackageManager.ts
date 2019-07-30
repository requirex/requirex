import { Package } from './Package';
import { LoaderConfig } from './Loader';

export interface PackageMeta {
	lockedVersion?: string;
	suggestedVersion?: string;
}

export const enum RepoKind {
	NORMAL = 1,
	CDN = 2
}

export class PackageManager {

	constructor(public config: LoaderConfig) { }

	registerCDN(cdn: string) {
		this.repoTbl[cdn] = RepoKind.CDN;
		this.cdn = cdn;
	}

	registerMeta(name: string) {
		return this.packageMetaTbl[name] || (this.packageMetaTbl[name] = {});
	}

	registerPackage(pkg: Package, rootKey?: string) {
		this.packageNameTbl[pkg.name] = pkg;
		this.packageConfTbl[pkg.root] = pkg;
		this.packageRootTbl[pkg.root] = pkg;

		if(rootKey) {
			this.packageConfTbl[rootKey] = pkg;
			this.packageRootTbl[rootKey] = pkg;
		}

		const meta = this.registerMeta(pkg.name);

		if(!meta.lockedVersion) meta.lockedVersion = pkg.version;
	}

	getPackage(key: string) {
		let end = key.length;

		do {
			const pkg = this.packageRootTbl[key.substr(0, end)];

			if(pkg && pkg instanceof Package) return pkg;
		} while(end && (end = key.lastIndexOf('/', end - 1)) >= 0);
	}

	/** Map package name to configuration metadata. */
	packageMetaTbl: { [name: string]: PackageMeta } = {};

	/** Map package name to package configuration or promise for one waiting to load. */
	packageNameTbl: { [name: string]: Package | false | Promise<Package | false> } = {};

	/** Map package root path to configuration or promise for one waiting to load. */
	packageConfTbl: { [resolvedRoot: string]: Package | false | Promise<Package | false> } = {};

	/** Map resolved keys to containing packages (keys not corresponding to a package root
	  * resolve to the same result as their parent directory does). */
	packageRootTbl: { [resolvedRoot: string]: Package | false | Promise<Package | false> } = {};

	/** Table of known repository root addresses. */
	repoTbl: { [resolvedPath: string]: RepoKind } = {}

	cdn: string;

}
