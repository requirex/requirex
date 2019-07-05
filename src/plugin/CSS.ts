import { URL } from '../URL';
import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { getTags } from '../platform';
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

export class CSS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	translate(record: Record) {
		const loader = this.loader;
		const config = loader.getConfig();
		const bundleName = 'requirex-postcss-bundle';

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

		if(!this.builder) return;

		return this.builder.then((builder: Lib.PostBuilder) => {
			return builder.build(
				record.sourceCode,
				wrap(record.resolvedKey)
			);
		}).then((code: string) => {
			record.sourceCode = code;
		}).catch((err: any) => {
			console.error(err);
		});
	}

	instantiate(record: Record) {
		if(!getTags) return;

		let element: HTMLStyleElement | HTMLLinkElement;
		const head = getTags('head')[0];

		if(record.sourceCode) {
			// Inject as a style element if transpiled.
			// Relative URLs must be fixed by the transpiler.
			console.log(record.sourceCode);

			const style = document.createElement('style');
			style.innerHTML = record.sourceCode;
			element = style;
		} else {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = record.resolvedKey;
			element = link;
		}

		element.type = 'text/css';

		head.appendChild(element);
	}

	builder: Promise<Lib.PostBuilder>;

}
