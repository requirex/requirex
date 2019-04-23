import { ModuleType } from './Module';
import { Loader } from './Loader';

export type ModuleFormat = 'js' | 'amd' | 'cjs' | 'system' | 'esm' | 'ts' | 'd.ts' | 'node';

export type ModuleFactory = (...args: any[]) => any;

export interface DepRef {
	baseKey?: string;
	isImport?: boolean;
	// importKey?: string;
	packageName?: string;
	defaultExt?: string;
	module?: ModuleType;
	record?: Record;
	format?: string;
	sourceCode?: string;
}

export class Record {

	constructor(
		public loader: Loader,
		/** Resolved module name. */
		public resolvedKey: string,
		/** Unresolved name used in import. */
		public importKey?: string
	) {}

	addDep(key: string) {
		const num = this.depList.length;
		this.depList[num] = key;
		return(num);
	}

	resolveDep(key: string, ref: DepRef) {
		this.depTbl[key] = ref;
	}

	/** Autodetected or configured format of the module. */
	format?: ModuleFormat;

	// formatBlacklist: { [format: ModuleFormat]: boolean } = {};
	formatBlacklist: { [format: string]: boolean } = {};

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
	factory: ModuleFactory;

	/** Promise resolved after discovery or rejected with a load error. */
	discovered?: Promise<void>;

}
