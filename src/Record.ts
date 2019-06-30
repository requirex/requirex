import { ModuleType } from './Module';
import { Package } from './Package';
import { assign } from './platform';
import { Loader } from './Loader';

export type ModuleFormat = 'js' | 'amd' | 'cjs' | 'system' | 'ts' | 'tsx' | 'd.ts' | 'node' | 'document';

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

	addDep(key: string, ref?: DepRef) {
		let num = this.depNumTbl[key];

		if(!num && num !== 0) {
			num = this.depList.length;
			this.depList[num] = key;
			this.depNumTbl[key] = num;
		}

		if(ref) this.resolveDep(key, ref);

		return num;
	}

	addBundled(child: Record) {
		child.parentBundle = this;
		(this.bundleChildren || (this.bundleChildren = [])).push(child);
		return child;
	}

	addGlobals(globalTbl: { [name: string]: any }) {
		assign(this.globalTbl, globalTbl);
	}

	resolveDep(key: string, ref: DepRef) {
		this.depTbl[key] = ref;
	}

	setArgs(...defs: { [name: string]: any }[]) {
		const argNames = [];
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

		this.argNames = argNames;
		this.argValues = argNames.map((name: string) => args[name]);
	}

	wrap() {
		return this.sourceCode && (
			'(function(' + this.argNames.join(', ') + ') {\n' +
			this.sourceCode +
			// Break possible source map comment on the last line.
			'\n})'
		);
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
	depNumTbl: { [key: string]: number } = {};

	globalTbl: { [name: string]: any } = {};

	/** Table of recursive dependencies seen, to break circular chains. */
	deepDepTbl: { [resolvedKey: string]: Record | undefined } = {};
	/** Promises for translations of all recursive dependencies. */
	deepDepList: Record[] = [];

	/** Fetched and translated source code. */
	sourceCode: string;
	/** Source code wrapped and compiled into an executable function. */
	compiled: ModuleFactory;
	factory: ModuleFactory;

	argNames: string[];
	argValues: any[];

	/** Index within bundle if applicable. */
	num?: number;

	/** Promise resolved after discovery or rejected with a load error. */
	discovered?: Promise<Record>;
	/** Latest format used in translation, to avoid repeating it. */
	translated?: ModuleFormat;

}
