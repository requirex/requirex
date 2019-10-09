import * as Lib from 'typescript';

import { Record } from '../Record';
import { makeTable, keys } from '../platform';
import { SourceMap, SourceMapSpec } from '../SourceMap';
import { Loader, LoaderPlugin } from '../Loader';

declare module '../Record' {
	interface Record {
		tsSnapshot?: Lib.IScriptSnapshot;
	}
}

const transpileFormats = makeTable('ts tsx jsx d.ts');

function createHost(loader: Loader, ts: typeof Lib): Lib.LanguageServiceHost {
	return ({
		getCompilationSettings: () => ({
			allowJs: true,
			jsx: ts.JsxEmit.React,
			noEmitOnError: false,
			sourceMap: true,
			target: ts.ScriptTarget.ES5,
			module: ts.ModuleKind.CommonJS
			// module: ts.ModuleKind.AMD
			// module: ts.ModuleKind.UMD
			// module: ts.ModuleKind.System
		}),
		getScriptFileNames: () => {
			const result: string[] = [];

			for(let key of keys(loader.records)) {
				const record = loader.records[key];

				if(transpileFormats[record.format!] || record.tsSnapshot) {
					result.push(key);
				}
			}

			return result;
		},
		getScriptVersion: (key: string) => {
			return '0';
		},
		getScriptSnapshot: (key: string) => {
			const record = loader.records[key];

			if(record) return record.tsSnapshot || (
				record.tsSnapshot = ts.ScriptSnapshot.fromString(record.sourceCode)
			);
		},
		getCurrentDirectory: () => '',
		getDefaultLibFileName: () => loader.resolveSync('typescript/lib/lib.d.ts')
	});
}

/** TypeScript loader plugin. */

export class TS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	discover(record: Record) {
		if(!this.lib) {
			this.lib = this.loader.import(
				'typescript',
				this.loader.baseURL || this.loader.firstParent
			);
		}

		return this.lib.then((ts: typeof Lib) => {
			if(!this.tsService) {
				this.tsHost = createHost(this.loader, ts);
				this.tsService = ts.createLanguageService(this.tsHost, ts.createDocumentRegistry());
			}

			const info = ts.preProcessFile(record.sourceCode, true, true);

			record.depList = [];

			for(let ref of info.referencedFiles.concat(info.importedFiles)) {
				record.addDep(ref.fileName);
			}

			for(let ref of info.libReferenceDirectives) {
				record.addDep('typescript/lib/lib.' + ref.fileName + '.d.ts');
			}

			record.addDep('typescript/lib/lib.d.ts');
		});
	}

	translate(record: Record) {
		if(record.format == 'd.ts') return;
		const key = record.resolvedKey;
		const jsKey = record.resolvedKey.replace(/\.[jt]sx?$/, '.js');
		const mapKey = jsKey + '.map';

		const keyTbl: { [key: string]: SourceMapSpec } = {};

		keyTbl[key] = {
			key: record.sourceKey || key,
			code: record.sourceOriginal
		};

		for(let info of this.tsService.getEmitOutput(key).outputFiles) {
			if(info.name == jsKey) {
				record.format = 'js';
				// Remove existing reference to a source map file.
				// It will be emitted inline instead.
				record.sourceCode = SourceMap.removeComment(info.text);
			}
			if(info.name == mapKey) {
				// Store source map, to be transformed and emitted later.
				record.sourceMap = new SourceMap(key, info.text, keyTbl);
			}
		}

		record.markDevDeps('d.ts');
	}

	/** Dummy instantiate for d.ts files. */
	instantiate(record: Record) { }

	lib: Promise<typeof Lib>;
	tsHost: Lib.LanguageServiceHost;
	tsService: Lib.LanguageService;

}
