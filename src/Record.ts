import { ModuleType } from './Module';
import { Package } from './Package';
import { Loader } from './Loader';

export type ModuleFormat = 'js' | 'amd' | 'cjs' | 'system' | 'esm' | 'ts' | 'tsx' | 'd.ts' | 'node';

export type ModuleFactory = (...args: any[]) => any;

export interface DepRef {
	/** True if dependency will be imported after resolving.
	  * Existance checks can also load the file to save data transfers. */
	isImport?: boolean;
	/** Name of referenced but not yet fetched package. */
	pendingPackageName?: string;
	defaultExt?: string;
	module?: ModuleType;
	record?: Record;
	package?: Package;
	format?: string;
	sourceCode?: string;
}

export class Record {

	constructor(
		public loader: Loader,
		/** Resolved module name. */
		public resolvedKey: string,
		/** Unresolved name used in import. */
		public importKey?: string,
		public pkg?: Package
	) { }

	addDep(key: string) {
		const num = this.depList.length;
		this.depList[num] = key;
		return num;
	}

	addBundled(child: Record) {
		child.parentBundle = this;
		(this.bundleChildren || (this.bundleChildren = [])).push(child);
		return child;
	}

	resolveDep(key: string, ref: DepRef) {
		this.depTbl[key] = ref;
	}

	wrapArgs(...defs: { [name: string]: any }[]) {
		const argNames: string[] = [];
		const args: { [name: string]: any } = {};

		for(let def of defs) {
			for(let name in def) {
				if(def.hasOwnProperty(name)) {
					argNames.push(name);
					args[name] = def[name];
				}
			}
		}

		argNames.sort();

		this.sourceCode = this.sourceCode && (
			'(function(' + argNames.join(', ') + ') {\n' +
			this.sourceCode +
			// Break possible source map comment on the last line.
			'\n})'
		);

		this.evalArgs = argNames.map((name: string) => args[name]);
	}

	/** Autodetected or configured format of the module. */
	format?: ModuleFormat;

	// formatBlacklist: { [format: ModuleFormat]: boolean } = {};
	formatBlacklist: { [format: string]: boolean } = {};

	parentBundle?: Record;
	bundleChildren?: Record[];

	/** Module object accessible from inside its code.
	  * Must be set in the translate step to support circular dependencies. */
	moduleInternal: ModuleType;
	isInstantiated?: boolean;

	loadError: any;

	/** Names of imports detected in source code or listed in AMD defines. */
	depList: string[] = [];
	/** Indices (offset by 3) of AMD define callback params in depList.
	  * Indices 0-2 reference require, exports, module. */
	depNumList: number[] = [];
	/** Map of import names to their load records or exported objects. */
	depTbl: { [key: string]: DepRef } = {};

	globalTbl: { [name: string]: any } = {};

	/** Table of recursive dependencies seen, to break circular chains. */
	deepDepTbl: { [resolvedKey: string]: Record } = {};
	/** Promises for translations of all recursive dependencies. */
	deepDepList: Record[] = [];

	/** Fetched and translated source code. */
	sourceCode: string;
	/** Source code wrapped and compiled into an executable function. */
	compiled: ModuleFactory;
	factory: ModuleFactory;
	evalArgs: any[];

	/** Index within bundle if applicable. */
	num?: number;

	/** Promise resolved after discovery or rejected with a load error. */
	discovered?: Promise<void>;

}
