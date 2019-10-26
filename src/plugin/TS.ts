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

class Host implements Lib.LanguageServiceHost {

	constructor(
		private loader: Loader,
		private ts: typeof Lib
	) {}

	getCompilationSettings() {
		const ts = this.ts;

		return {
			allowJs: true,
			esModuleInterop: true,
			jsx: ts.JsxEmit.React,
			noEmitOnError: false,
			/** Allow transpiling JS -> JS (identical input and output paths). */
			suppressOutputPathCheck: true,
			sourceMap: true,
			target: ts.ScriptTarget.ES5,
			module: ts.ModuleKind.CommonJS
			// module: ts.ModuleKind.AMD
			// module: ts.ModuleKind.UMD
			// module: ts.ModuleKind.System
		};
	}

	getScriptFileNames() {
		return keys(this.records);
	}

	getScriptVersion(key: string) {
		return '0';
	}

	getScriptSnapshot(key: string) {
		const record = this.records[key];

		if(record) {
			return record.tsSnapshot || (
				record.tsSnapshot = this.ts.ScriptSnapshot.fromString(record.sourceCode)
			);
		}
	}

	getCurrentDirectory() {
		return '';
	}

	getDefaultLibFileName() {
		return this.loader.resolveSync('typescript/lib/lib.d.ts');
	}

	records: { [resolvedKey: string]: Record };

}

function transformKey(record: Record) {
	const format = record.format!;
	let key = record.resolvedKey;
	const extension = key.match(/(\.[a-z]+)?$/)![0];

	if(!extension) {
		key += '.' + (transpileFormats[format] ? format : 'js');
	} else if(extension != format && (format == 'jsx' || format == 'tsx')) {
		key = key.substr(0, key.length - extension.length + 1) + format;
	}

	return key;
}

function transformKeys(loader: Loader) {
	const records: { [resolvedKey: string]: Record } = {};

	for(let key of keys(loader.records)) {
		const record = loader.records[key];

		if(transpileFormats[record.format!] || record.tsSnapshot) {
			records[transformKey(record)] = record;
		}
	}

	return records;
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
				this.tsHost = new Host(this.loader, ts);
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

		const key = transformKey(record);
		const jsKey = key.replace(/\.[jt]sx?$/, '.js');
		const mapKey = jsKey + '.map';

		const keyTbl: { [key: string]: SourceMapSpec } = {};

		keyTbl[key] = {
			key: record.sourceKey || record.resolvedKey,
			code: record.sourceOriginal
		};

		this.tsHost.records = transformKeys(this.loader);

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

		// Turn imports in TypeScript code into dev dependencies.
		// Actual run-time dependencies will be detected in transpiled output.
		record.setDepsDev();
	}

	/** Dummy instantiate for d.ts files. */
	instantiate(record: Record) { }

	lib: Promise<typeof Lib>;
	tsHost: Host;
	tsService: Lib.LanguageService;

}
