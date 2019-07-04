import { URL } from '../URL';
import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { getTags } from '../platform';
import * as Lib from 'requirex-postcss-bundle';

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
				importResolve: (key: string, dir: string) => {
					// TODO: Resolve http URLs?
					dir = dir.replace(/\/?$/, '/');
					console.log('CSS RESOLVE', key, dir, URL.resolve(dir, key));

					// NOTE: Promise wrapper is just for testing that returning promises works.
					return(Promise.resolve(URL.resolve(dir, key)));
				},
				importLoad: (key: string) => {
					const resolvedKey = URL.resolve(
						loader.baseURL || loader.firstParent!,
						key
					);

					console.log('CSS LOAD', key, resolvedKey);
					// TODO: Use System.import?
					// TODO: Load http URLs?

					return loader.fetch(resolvedKey).then(
						(res) => res.ok ? res.text() : Promise.reject(res)
					);
				},
				urlResolve: (key: string, isLocal: boolean) => URL.relative(
					loader.baseURL || loader.firstParent!,
					isLocal ? URL.fromLocal(key) : key
				),
				minify: config.minifyCSS
			}));
		}

		if(!this.builder) return;

		return this.builder.then((builder: Lib.PostBuilder) => {
			console.log(builder);
			return builder.build(
				URL.toLocal(record.resolvedKey),
				URL.toLocal(loader.baseURL || loader.firstParent!)
			);
		}).then((code: string) => {
			record.sourceCode = code;
		}).catch((err: any) => {
			console.error(err);
		});
	}

	instantiate(record: Record) {
if(record.sourceCode) {
	console.log(record.sourceCode);
}

		if(!getTags) return;
		const head = getTags('head')[0];

		// Inject as a style element if transpiled.
		// Relative URLs must be fixed by the transpiler.
		// const element = document.createElement('style');
		const element = document.createElement('link');
		element.type = 'text/css';
		// element.innerHTML = record.sourceCode;
		element.rel = 'stylesheet';
		element.href = record.resolvedKey;

		head.appendChild(element);
	}

	builder: Promise<Lib.PostBuilder>;

}
