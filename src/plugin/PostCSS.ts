import { URL } from '../URL';
import { Record } from '../Record';
import { SourceMap } from '../SourceMap';
import { Loader, LoaderPlugin } from '../Loader';
import * as Lib from 'requirex-postcss-bundle';

const nonce = '/' + Math.random() + '/';
const reNonce = new RegExp('^(file://)?' + nonce);
const slashes = '_SLASHES_';

function wrap(key: string) {
	return (nonce + key).replace('://', slashes);
}

function unwrap(key: string) {
	return key.replace(reNonce, '').replace(slashes, '://');
}

/** CSS loader plugin. */

export class PostCSS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	translate(record: Record) {
		const loader = this.loader;
		const config = loader.getConfig();
		const bundleName = 'requirex-postcss-bundle';

		// TODO: Avoid re-transpiling cached already transpiled code!

		record.moduleInternal = {
			exports: {},
			id: record.resolvedKey
		};

		if(!this.builder && config.postCSS) {
			this.builder = loader.import(
				bundleName,
				loader.baseURL || loader.firstParent
			).then(
				() => loader.import(bundleName + '/src/index.ts')
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
						loader.baseURL || loader.firstParent!,
						unwrap(key)
					);

					return loader.fetch(resolvedKey).then(
						(res) => res.ok ? res.text() : Promise.reject(res)
					);
				},
				urlResolve: (importKey: string, baseKey: string) => {
					return URL.relative(
						loader.baseURL || loader.firstParent!,
						URL.resolve(unwrap(baseKey), importKey)
					)
				},
				minify: config.minifyCSS
			}));
		}

		if(!this.builder) {
			record.format = 'cssraw';
			return;
		}

		return this.builder.then((builder: Lib.PostBuilder): Promise<string | undefined> | string | undefined => {
			return record.sourceCode && builder.build(
				record.sourceCode,
				wrap(record.resolvedKey)
			);
		}).then((code: string | undefined) => {
			record.format = 'cssraw';
			record.sourceCode = code;
		}).catch((err: any) => {
			console.error(err);
		});
	}

	builder: Promise<Lib.PostBuilder>;

}
