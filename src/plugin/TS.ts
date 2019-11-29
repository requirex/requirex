import * as Lib from 'typescript';

import { Record } from '../Record';
import { SourceMap, SourceMapSpec } from '../SourceMap';
import { makeTable, keys } from '../platform';
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
			inlineSourceMap: false,
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
				record.tsSnapshot = this.ts.ScriptSnapshot.fromString(record.sourceCode || '')
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

/** Replace or add missing extension to ensure the TypeScript compiler
  * recognizes it. Force a .jsx or .tsx extension in files containing JSX,
  * even if actual extension is different. */

function transformKey(record: Record) {
	const format = record.format!;
	const key = record.resolvedKey;
	const extension = key.match(/(\.([a-z]+))?$/)![2] || '';

	return (
		!extension ||
		(extension != format && (format == 'jsx' || format == 'tsx')) ||
		(!transpileFormats[extension] && extension != 'js')
	) ? (
		key.substr(0, key.length - extension.length) +
		(extension ? '' : '.') + (transpileFormats[format] ? format : 'js')
	) : key;
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

			const info = ts.preProcessFile(record.sourceCode || '', true, true);

			// Deps will be re-detected in the transpiled output.
			record.clearDeps();

			for(let ref of (info.referencedFiles || []).concat(info.importedFiles || [])) {
				record.addDep(ref.fileName);
			}

			for(let ref of info.libReferenceDirectives || []) {
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

		// If unmodified source (such as full HTML code) is not passed to the
		// TypeScript compiler, ensure it still ends up in the source map.

		keyTbl[key] = {
			key: record.sourceKey || record.resolvedKey,
			code: record.sourceOriginal
		};

		this.tsHost.records = transformKeys(this.loader);

		for(let info of this.tsService.getEmitOutput(key).outputFiles) {
			if(info.name == jsKey) {
				record.format = 'js';
				record.sourceCode = info.text;
				record.extractSourceMap();
			} else if(info.name == mapKey) {
				record.sourceMap = new SourceMap(record.resolvedKey, info.text, keyTbl);
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
