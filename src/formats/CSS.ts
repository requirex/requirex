import * as Lib from 'requirex-postcss-bundle';

import { URL } from '../platform/URL';
import { Zalgo, keys } from '../platform/util';
import { features } from '../platform/features';
import { Importation } from '../Status';
import { Record } from '../Record';
import { SourceMap, SourceMapData } from '../SourceMap';
import { LoaderPlugin, NextFetchRecord, pluginFactory } from '../Plugin';
import { Loader } from '../Loader';

const nonce = '/' + Math.random() + '/';
const reNonce = new RegExp('^(file://)?' + nonce);
const slashes = '_SLASHES_';

function wrap(key: string) {
	return (nonce + key).replace('://', slashes);
}

function unwrap(key: string) {
	return key.replace(reNonce, '').replace(slashes, '://');
}

interface CSSConfig {

	postCSS?: boolean;
	minifyCSS?: boolean;

}

type WorkerResult = { css: string, map?: SourceMapData };

class CSSWorker {

	constructor(private loader: Loader, config?: CSSConfig) {
		this.config = config || {};
	}

	translate(key: string, source: string) {
		const loader = this.loader;
		const config = loader.config;
		const bundleName = 'requirex-postcss-bundle';

		const builder = this.builder || (
			this.builder = loader.import(
				bundleName,
				config.baseURL || config.libraryBaseKey
			).then((lib: typeof Lib) => new lib.PostBuilder({
				importResolve: (importKey: string, baseKey: string) => {
					baseKey = unwrap(baseKey).replace(/\/?$/, '/');

					if(importKey.charAt(0) != '~') {
						return wrap(URL.resolve(baseKey, importKey));
					}

					// TODO: Parse package.json "style" field!
					// Otherwise default to index.css if "main" is not a .css file.

					return loader.resolve(importKey.substr(1), baseKey).then(
						(resolvedKey) => wrap(resolvedKey)
					);
				},
				importLoad: (key: string) => {
					const resolvedKey = URL.resolve(
						config.baseURL || config.libraryBaseKey!,
						unwrap(key)
					);

					return loader.fetch(resolvedKey).then(
						(res) => res.ok ? res.text() : Promise.reject(res)
					);
				},
				urlResolve: (importKey: string, baseKey: string) => {
					return URL.relative(
						config.baseURL || config.libraryBaseKey!,
						URL.resolve(unwrap(baseKey), importKey)
					)
				},
				minify: this.config.minifyCSS
			}))
		);

		return builder.then((builder: Lib.PostBuilder): Promise<WorkerResult> | WorkerResult => {
			if(!source) return { css: '' };

			return builder.build(source, wrap(key)).then(({ css, map }) => {
				const mappings = map && map._mappings;
				const sources = map && map._sources;
				const contents = map && map._sourcesContents;
				const mapArray = mappings && mappings._array;
				const srcArray = sources && sources._array;

				if(mapArray && srcArray && sources._set) {
					sources._set.clear();

					for(let num = 0; num < srcArray.length; ++num) {
						srcArray[num] = unwrap(srcArray[num]);
						sources._set.set(srcArray[num], num);
					}

					for(let item of mapArray) {
						item.source = unwrap(item.source);
					}

					for(let key of keys(contents || {})) {
						contents[unwrap(key)] = contents[key];
						delete contents[key];
					}

					if(map._file) map._file = unwrap(map._file);

					map = map.toJSON() as SourceMapData;
				}

				return { css, map };
			});
		});
	}

	builder?: Promise<Lib.PostBuilder>;

	config: CSSConfig;

}

/** CSS loader plugin. */

export class CSSPlugin implements LoaderPlugin {

	constructor(private loader: Loader, config?: CSSConfig, worker?: CSSWorker) {
		this.config = config || {};
		this.worker = worker!;
	}

	fetchRecord(record: Record, importation: Importation, next: NextFetchRecord): Zalgo<Record> {
		return this.config.postCSS ? next(record, importation, this) : record;
	}

	analyze(record: Record) { }

	translate(record: Record) {
		const source = record.sourceCode;

		record.moduleInternal = {
			exports: {},
			id: record.resolvedKey
		};

		// Avoid re-transpiling cached already transpiled code.
		if(!this.config.postCSS || !source || record.isPreprocessed) return;

		return this.worker.translate(record.resolvedKey, source).then(({ css, map }) => {
			record.sourceMap = new SourceMap('', map);
			record.update(css);
		}).catch((err: any) => {
			console.error(err);
		});
	}

	instantiate(record: Record) {
		if(!features.doc) return;

		let element: HTMLStyleElement | HTMLLinkElement;
		const code = record.sourceCode || record.compiled;

		if(typeof code == 'string') {
			// Inject as a style element if transpiled.
			// Relative URLs must be fixed by the transpiler.

			const style = document.createElement('style');
			style.innerHTML = code + record.getPragma();
			element = style;
		} else {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = record.resolvedKey;
			element = link;
		}

		element.type = 'text/css';
		features.doc.head.appendChild(element);
	}

	wrap(record: Record) {
		return JSON.stringify(record.sourceCode || record.compiled || '');
	}

	builder?: Promise<Lib.PostBuilder>;

	config: CSSConfig;

	extensions: { [name: string]: LoaderPlugin | undefined } = {
		css: this
	};

	worker: CSSWorker;

	id?: string;

}

export const CSS = pluginFactory('css', CSSPlugin, CSSWorker);

// Avoid loading PostCSS bundle in all workers.
(CSSWorker.prototype.translate as any).affinity = 'css';
