import { ModuleType } from './Module';
import { Package } from './Package';
import { globalEval, keys, assign } from './platform';
import { SourceMap } from './SourceMap';
import { ChangeSet } from './ChangeSet';
import { Loader } from './Loader';

export type ModuleFormat = (
	'js' |
	'jsx' |
	'amd' |
	'cjs' |
	'system' |
	'ts' |
	'tsx' |
	'd.ts' |
	'node' |
	'document' |
	'css' |
	'cssraw'
);

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
	/** Custom loader plugin. */
	plugin?: any;
	/** Argument to a custom loader plugin. */
	pluginArg?: string;
	sourceKey?: string;
	sourceCode?: string;
	sourceOriginal?: string;
	changeSet?: ChangeSet;
	eval?: (record: Record) => void;
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

	/** Turn all dependencies detected so far into devDependencies. */

	setDepsDev() {
		let depList = this.depList;
		this.depList = [];

		for(let key of depList) {
			const dep = this.depTbl[key];

			this.depNumTbl[key] = void 0;

			if(dep && !this.devDepTbl[key]) {
				this.devDepTbl[key] = dep;
				this.devDepList.push(key);
			}
		}
	}

	setArgs(...defs: { [name: string]: any }[]) {
		const argTbl = this.argTbl;

		for(let def of defs) {
			assign(argTbl, def);
		}

		const argNames = keys(argTbl).sort();

		this.argNames = argNames;
		this.argValues = argNames.map((name: string) => argTbl[name]);
	}

	/** Instantiate after translating all detected dependencies.
	  * TODO: Make sure this does not get executed multiple times for the same record! */

	init(loader: Loader, instantiate?: boolean) {
		return Promise.all(this.deepDepList.map(
			(record: Record) => loader.translate(record).then(
				() => record.isDirty && loader.update(record) && void 0
			)
		)).then(
			() => instantiate ? loader.instantiate(this) : this
		)
	}

	withSource() {
		return this.sourceCode +
		'\n//# sourceURL=' + this.resolvedKey +
		(!this.sourceMap ? '' :
			'!transpiled' +
			'\n//# sourceMappingURL=' + this.sourceMap.encodeURL()
		)
	}

	withWrapper() {
		const [prologue, epilogue] = this.getWrapper();
		return prologue + this.withSource() + epilogue;
	}

	getWrapper() {
		return [
			'(function(' + this.argNames.join(',') + '){',
			'})'
		];
	}

	wrap() {
		const record = this;
		const [prologue, epilogue] = this.getWrapper();
		const compiled = globalEval(
			// Wrapper function for exposing "global" variables to the module.
			prologue +
			// Run unmodified module source code inside the wrapper function,
			// preserving correctness of any original source map.
			'return eval(' +
			// Get source code from last, unnamed argument and hide the argument.
			'(function(a,c){' +
			'c=a[a.length-1];a[a.length-1]=void 0;a.length=0;return c' +
			'})(arguments)' +
			')' +
			epilogue
		);

		return function(this: any) {
			const args: any[] = [].slice.call(arguments);

			args.push(record.withSource());

			return compiled.apply(this, args);
		};
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
	depTbl: { [key: string]: DepRef | undefined } = {};
	depNumTbl: { [key: string]: number | undefined } = {};
	devDepTbl: { [key: string]: DepRef | undefined } = {};
	devDepList: string[] = [];

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

	/** Address to show in sourceURL comment. */
	sourceKey?: string;
	sourceMap?: SourceMap;
	sourceOriginal?: string;

	/** True if source code has changed and cache should be updated. */
	isDirty?: boolean;

	/** Changes already applied to the source code. */
	changeSet?: ChangeSet;

	/** Optional custom evaluation function. For example HTML inline scripts
	  * cannot use default eval() because they need a shared scope. */
	eval?: (record: Record) => void;

	argTbl: { [name: string]: any } = {};
	argNames: string[] = [];
	argValues: any[] = [];

	/** Index within bundle if applicable. */
	num?: number;

	/** Promise resolved after discovery or rejected with a load error. */
	discovered?: Promise<Record>;
	/** Latest format used in translation, to avoid repeating it. */
	translated?: ModuleFormat;

}
