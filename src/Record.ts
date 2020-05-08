import { assign, keys } from './platform/util';
import { globalEval } from './platform/global';
import { PluginStack, LoaderPlugin } from './Plugin';
import { Importation, CustomPlugin, addPlugin } from './Status';
import { ModuleObject } from './ModuleObject';
import { Package } from './packages/Package';
import { SourceMap } from './SourceMap';

/** Serialized form of a bundled package. */

export interface BuiltSpec {

	/** Package name. */
	name: string;
	version: string;
	root: string;
	main: string;

	/** Browser import mappings from package.json. */
	map: { [key: string]: string };

	/** File names, formats and dependency names mapped to
	  * their index in the bundle, or -1 if defined elsewhere. */
	files: [string, string, { [importKey: string]: number }, any][];

}

export type ModuleFactory = (...args: any[]) => any;

/** Every distinct imported URL has a unique record with all related metadata. */

export class Record {

	constructor(
		public resolvedKey: string,
		importation: Importation
	) {
		this.extension = importation.extension || '';
		this.package = importation.package;
		this.pluginStack = importation.pluginStack;
		this.resolveStack = importation.pluginStack;
		/* this.customPlugin = importation.customPlugin;
		this.customArg = importation.customArg; */
		this.sourceCode = importation.sourceCode;
	}

	addImport(importKey: string, importation?: Importation) {
		let num = this.importNumTbl[importKey];

		if(!num && num !== 0) {
			num = this.importList.length;
			this.importList[num] = importKey;
			this.importNumTbl[importKey] = num;
		}

		if(importation) this.resolveImport(importKey, importation);

		return num;
	}

	resolveImport(importKey: string, importation: Importation) {
		this.importTbl[importKey] = importation;
	}

	/** Turn all dependencies detected so far into devDependencies. */

	stashImports() {
		const importList = this.importList;

		for(let key of importList) {
			const dep = this.importTbl[key];

			if(dep && !this.devImportTbl[key]) {
				this.devImportTbl[key] = dep;
				this.devImportList.push(key);
			}

			this.importNumTbl[key] = void 0;
		}

		importList.length = 0;
	}

	addGlobals(globals: { [name: string]: any }) {
		assign(this.globals, globals);
	}

	/** Push a new loader plugin on this record's (immutable) plugin stack. */

	addPlugin(plugin: LoaderPlugin) {
		this.pluginStack = addPlugin(plugin, this.pluginStack);
	}

	/** Remove a loader plugin from this record's (immutable) plugin stack.
	  * Copies references on top of the unwanted plugin, and references the
	  * rest of the unmodified old stack.
	  *
	  * @param plugin Plugin instance to remove. */

	removePlugin(plugin: LoaderPlugin) {
		let src: PluginStack | undefined = this.pluginStack;

		if(src.plugin == plugin) {
			this.pluginStack = src.next!;
			return;
		}

		let dst: PluginStack = { plugin: src.plugin };
		this.pluginStack = dst;

		while((src = src.next)) {
			if(src.plugin == plugin) {
				dst.next = src.next;
				return;
			}

			dst.next = { plugin: src.plugin };
			dst = dst.next;
		}
	}

	addBundled(child: Record) {
		child.parentBundle = this;
		(this.bundleChildren || (this.bundleChildren = [])).push(child);
		return child;
	}

	/** Set arguments passed to wrapper function and bound in compiled code,
	  * for example "define", "require" and globals.
	  *
	  * @param defs Additions to environment visible from compiled code. */

	setArgs(...defs: { [name: string]: any }[]) {
		const argTbl = this.argTbl;

		for(let def of defs) {
			assign(argTbl, def);
		}

		const argNames = keys(argTbl).sort();

		this.argNames = argNames;
		this.argValues = argNames.map((name: string) => argTbl[name]);
	}

	extractSourceMap() {
		const code = this.sourceCode;
		if(!code) return;

		let url: string | undefined;
		const common = '[#@][ \t]*source(Mapping)?URL[ \t]*=[ \t]*([^\r\n';

		this.sourceCode = code.replace(
			new RegExp((
				'(?:^|\n)[ \t]*(?:' +
				'//' + common + ']+)|' +
				'/*' + common + '*]+)\*/' +
				')'
			), 'g'),
			(match, kind1, url1, kind2, url2) => {
				if((kind1 || kind2) == 'Mapping') {
					url = (url1 || url2).replace(/^[ \t'"]+/, '').replace(/[ \t'"]+$/, '');
				}

				return '';
			}
		);

		if(url && !this.sourceMap) {
			this.sourceMap = new SourceMap(url);
		}

		return this.sourceMap;
	}

	getPragma() {
		// Use block comment to support CSS.
		return '\n/*# sourceURL=' + this.resolvedKey + (!this.sourceMap ? '' :
			'!transpiled*/' +
			'\n/*# sourceMappingURL=' + this.sourceMap.encodeURL()
		) + '*/\n'
	}

	getWrapper() {
		return [
			'(function(' + this.argNames.join(', ') + ') {\n',
			'\n})'
		];
	}

	wrap(): ModuleFactory {
		const record = this;
		const [prologue, epilogue] = this.getWrapper();

		if(!this.sourceMap) {
			return globalEval(
				prologue +
				(this.sourceCode || '') +
				epilogue +
				this.getPragma()
			);
		}

		const compiled = globalEval(
			// Wrapper function for exposing "global" variables to the module.
			prologue + (
				// Run unmodified module source code inside the wrapper function,
				// preserving correctness of any original source map.
				'return eval(' + (
					// Get source code from last, unnamed argument and hide the argument.
					'(function(a,c){' +
					'c=a[a.length-1];a[a.length-1]=void 0;a.length=0;return c' +
					'})(arguments)'
				) + ')'
			) + epilogue
		);

		return function(this: any) {
			const args: any[] = [].slice.call(arguments);

			args.push((record.sourceCode || '') + record.getPragma());

			return compiled.apply(this, args);
		};
	}

	/** Update source code. Called during translation to apply changes. */

	update(code: string) {
		this.sourceCode = code;
		this.isDirty = true;
	}

	getFormat() {
		return this.pluginStack.plugin.id;
	}

	argTbl: { [name: string]: any } = {};
	argNames: string[] = [];
	argValues: any[] = [];

	parentBundle?: Record;
	bundleChildren?: Record[];

	compiled?: ModuleFactory;
	factory?: ModuleFactory;

	/** Address to show in sourceURL comment. */
	sourceKey?: string;
	sourceMap?: SourceMap;
	sourceOriginal?: string;

	/** Current file extension, used as file format name if not defined by plugin stack top plugin. */
	extension: string;

	/** AMD loader plugin. */
	// customPlugin?: CustomPlugin;

	/** Argument for AMD loader plugin. */
	// customArg?: string;

	/** Resolves after any necessary source file has been fetched. */
	fetched?: Promise<Record>;

	/** Global variables exposed to instantiated code. */
	globals: { [name: string]: any } = {};

	/** Names of imports detected in source code or listed in AMD defines. */
	importList: string[] = [];
	/** Indices (offset by 3) of AMD define callback params in importList.
	  * Indices 0-2 reference require, exports, module. */
	importNumList: number[] = [];
	/** Map of import names to their load records or exported objects. */
	importTbl: { [key: string]: Importation | undefined } = {};
	importNumTbl: { [key: string]: number | undefined } = {};
	devImportTbl: { [key: string]: Importation | undefined } = {};
	devImportList: string[] = [];

	isAnalyzed?: true;
	isTranslating?: true;
	isInstantiated?: true;

	/** True if code was loaded from already translated cache or bundle. */
	isPreprocessed?: true;

	/** True if code has changed in translation and cache not yet updated. */
	isDirty?: boolean;

	/** Module object accessible from inside its code.
	  * Must be set in the translate step to support circular dependencies. */
	moduleInternal?: ModuleObject;

	/** True if code seems to use ES6 syntax. */
	hasES6?: boolean;

	/** True if code contains JSX elements. */
	hasJSX?: boolean;

	/** Index in bundle. Used during bundling. */
	num?: number;

	package: Package;

	/** Loader plugins used during loading.
	  * An immutable stack structure. */
	pluginStack: PluginStack;

	/** Plugins for resolving other files referenced in imports. */
	resolveStack: PluginStack;

	sourceCode?: string;

}
