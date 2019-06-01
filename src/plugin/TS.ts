import * as _ts from 'typescript';

import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

declare module '../Record' {
	interface Record {
		tsSnapshot: _ts.IScriptSnapshot
	}
}

function createHost(loader: Loader, ts: typeof _ts): _ts.LanguageServiceHost {
	return ({
		getCompilationSettings: () => ({
			jsx: ts.JsxEmit.React,
			noEmitOnError: false,
			target: ts.ScriptTarget.ES5,
			// module: ts.ModuleKind.CommonJS
			// module: ts.ModuleKind.AMD
			// module: ts.ModuleKind.UMD
			module: ts.ModuleKind.System
		}),
		getScriptFileNames: () => {
			const keys: string[] = [];

			for(let key in loader.records) {
				if(!loader.records.hasOwnProperty(key)) continue;

				const record = loader.records[key];
				const format = record.format;

				if(format == 'ts' || format == 'd.ts' || record.tsSnapshot) {
					keys.push(key.replace(/\.js$/, '.ts'));
				}

				if(format == 'tsx') {
					keys.push(key.replace(/\.js$/, '.tsx'));
				}
			}

			return keys;
		},
		getScriptVersion: (key: string) => {
			return '0';
		},
		getScriptSnapshot: (key: string) => {
			const record = loader.records[key] || loader.records[key.replace(/\.tsx?$/, '.js')];

			return record.tsSnapshot || (
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
		return this.loader.import('typescript', this.loader.baseURL || this.loader.firstParent).then((ts: typeof _ts) => {
			if(!this.tsService) {
				this.tsHost = createHost(this.loader, ts);
				this.tsService = ts.createLanguageService(this.tsHost, ts.createDocumentRegistry());
			}

			const info = ts.preProcessFile(record.sourceCode, true, true);

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
		const tsKey = record.resolvedKey.replace(/\.js$/, '.' + record.format);
		const jsKey = record.resolvedKey.replace(/\.tsx?$/, '.js');

		for(let info of this.tsService.getEmitOutput(tsKey).outputFiles) {
			if(info.name == jsKey) {
				record.format = 'js';
				record.sourceCode = info.text;
			}
		}
	}

	/** Dummy instantiate for d.ts files. */
	instantiate(record: Record) { }

	tsHost: _ts.LanguageServiceHost;
	tsService: _ts.LanguageService;

}
