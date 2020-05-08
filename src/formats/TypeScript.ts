import * as Lib from 'typescript';

import { Importation } from '../Status';
import { Record } from '../Record';
import { SourceMap, SourceMapSpec } from '../SourceMap';
import { keys, makeTable, Zalgo } from '../platform/util';
import { LoaderPlugin, pluginFactory, NextResolve } from '../Plugin';
import { Loader } from '../Loader';

class Host implements Lib.LanguageServiceHost {

	constructor(
		private ts: typeof Lib,
		private libKey: string
	) { }

	getCompilationSettings() {
		const ts = this.ts;

		return {
			allowJs: true,
			checkJs: false,
			diagnostics: false,
			esModuleInterop: true,
			inlineSourceMap: false,
			jsx: ts.JsxEmit.React,
			noEmitOnError: false,
			/** Allow transpiling JS -> JS (identical input and output paths). */
			suppressOutputPathCheck: true,
			sourceMap: true,
			strict: false,
			target: ts.ScriptTarget.ES5,
			module: ts.ModuleKind.CommonJS
			// module: ts.ModuleKind.AMD
			// module: ts.ModuleKind.UMD
			// module: ts.ModuleKind.System
		};
	}

	getScriptFileNames() {
		return keys(this.sources);
	}

	getScriptVersion(key: string) {
		return '0';
	}

	getScriptSnapshot(key: string) {
		const code = this.sources[key];

		if(code) {
			return this.snapshots[key] || (
				this.snapshots[key] = this.ts.ScriptSnapshot.fromString(code || '')
			);
		}
	}

	getCurrentDirectory() {
		return '';
	}

	getDefaultLibFileName() {
		return this.libKey;
	}

	sources: { [resolvedKey: string]: string | undefined } = {};
	snapshots: { [resolvedKey: string]: Lib.IScriptSnapshot | undefined } = {};

}

/** Replace or add missing extension to ensure the TypeScript compiler
  * recognizes it. Force a .jsx or .tsx extension in files containing JSX,
  * even if actual extension is different. */

function transformKey(record: Record, extensions: { [name: string]: any }) {
	let key = record.resolvedKey;
	const extension = record.extension;

	if(!extension) {
		key += '.ts';
	} else if(!extensions[extension]) {
		key = key.substr(0, key.length - extension.length) + 'ts';
	}

	if(record.hasJSX && !/x$/.test(key)) key += 'x';

	return key;
}

class TypeScriptWorker {

	constructor(private loader: Loader, config?: {}) { }

	getLib() {
		return this.lib || (
			this.lib = this.loader.import(
				'typescript',
				this.loader.config.baseURL || this.loader.config.libraryBaseKey
			).then((ts: typeof Lib) => {
				this.tsHost = new Host(ts, this.loader.resolveSync(this.libKey));
				this.tsService = ts.createLanguageService(this.tsHost, ts.createDocumentRegistry());

				return ts;
			})
		);
	}

	analyze(code: string) {
		return this.getLib().then((ts: typeof Lib) => {
			const info = ts.preProcessFile(code, true, true);
			const importList: string[] = [];

			for(let ref of(info.referencedFiles || []).concat(info.importedFiles || [])) {
				// Ignore require() calls reported by preProcessFile, because
				// our parser can also detect if require has been redefined.
				const len = Math.min(ref.pos, 32);

				if(!/require\s*\(\s*["']?$/.test(code.substr(ref.pos - len, len))) {
					importList.push(ref.fileName);
				}
			}

			for(let ref of info.libReferenceDirectives || []) {
				importList.push('typescript/lib/lib.' + ref.fileName + '.d.ts');
			}

			importList.push(this.libKey);
			return importList;
		});
	}

	translate(key: string, sources: { key: string, code: string }[]) {
		return this.getLib().then((ts: typeof Lib) => {
			let code: string | undefined;
			let map: string | undefined;

			for(let { key, code } of sources) {
				this.tsHost!.sources[key] = code;
			}

			const jsKey = key.replace(/\.[jt]sx?$/, '.js');
			const mapKey = jsKey + '.map';

			for(let info of this.tsService!.getEmitOutput(key).outputFiles) {
				if(info.name == jsKey) {
					code = info.text;
				} else if(info.name == mapKey) {
					map = info.text;
				}
			}

			return { code, map };
		});
	}

	translateSingle(key: string, sources: { key: string, code: string }[]) {
		return this.translate(key, sources);
	}

	lib?: Promise<typeof Lib>;
	tsHost?: Host;
	tsService?: Lib.LanguageService;

	libKey = 'typescript/lib/lib.d.ts';

}

/** TypeScript loader plugin. */

export class TypeScriptPlugin implements LoaderPlugin {

	constructor(private loader: Loader, config?: {}, worker?: TypeScriptWorker) {
		this.worker = worker!;
		(this.sourceList as any).threads = [];
	}

	resolve(importation: Importation, next: NextResolve): Zalgo<string> {
		const extensionList = importation.extensionList;

		extensionList.push('ts');
		extensionList.push('tsx');

		return next(importation, this);
	}

	analyze(record: Record) {
		return this.worker.analyze(record.sourceCode || '').then((importList) => {
			for(let key of importList) {
				record.addImport(key);
			}
		})
	}

	translate(record: Record) {
		if(record.extension == 'd.ts') return;

		const key = transformKey(record, this.extensions);
		let translated: Promise<{ code?: string, map?: string }>;

		if(this.extensions[record.extension]) {
			// Get source code from previously unseen records.
			for(let otherKey of keys(this.loader.records)) {
				const otherRecord = this.loader.records[otherKey]!;

				if(!this.seenTbl[otherKey] && (this.extensions[otherRecord.extension] /* || otherRecord.hasES6 || otherRecord.hasJSX */)) {
					this.seenTbl[otherKey] = 1;
					this.sourceList.push({
						key: transformKey(otherRecord, this.extensions),
						code: otherRecord.sourceCode || ''
					});
				}
			}
			translated = this.worker.translate(key, this.sourceList);
		} else {
			translated = this.worker.translateSingle(key, [{ key, code: record.sourceCode || '' }]);
		}

		return translated.then(({ code, map }) => {
			if(code) {
				record.update(code);
				record.extractSourceMap();
			}

			if(map) {
				const keyTbl: { [key: string]: SourceMapSpec } = {};
				// If unmodified source (such as full HTML code) is not passed to the
				// TypeScript compiler, ensure it still ends up in the source map.

				keyTbl[key] = {
					key: record.sourceKey || record.resolvedKey,
					code: record.sourceOriginal
				};

				record.sourceMap = new SourceMap(record.resolvedKey, map, keyTbl);
			}

			// Turn imports in TypeScript code into dev dependencies.
			// Actual run-time dependencies will be detected in transpiled output.
			record.stashImports();

			record.removePlugin(this);
		});
	}

	/** Dummy instantiate for d.ts files. */
	instantiate(record: Record) { }

	seenTbl: { [resolvedKey: string]: number } = {};
	sourceList: { key: string, code: string }[] = [];

	extensions = makeTable('ts tsx jsx d.ts');
	worker: TypeScriptWorker;

	id?: string;

}

export const TypeScript = pluginFactory('ts', TypeScriptPlugin, TypeScriptWorker);

// Avoid transpiling TypeScript in all workers,
// because they process the entire project to support const enums etc.
(TypeScriptWorker.prototype.translate as any).affinity = 'ts';
