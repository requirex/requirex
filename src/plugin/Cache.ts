import { fetch, FetchOptions, FetchHeaders, FetchResponse } from '../fetch';
import { ModuleFormat } from '../Record';
import { Loader } from '../Loader';
import { features } from '../platform';

const prefixMeta = 'requirex:meta:';
const prefixText = 'requirex:text:';

export interface CacheMeta {
	ok: boolean;
	status?: number;
	url: string;
	stamp: number;
	headers: FetchHeaders;
	format?: ModuleFormat;
	deps?: string[];
}

// TODO: Storage "polyfill" for Node, using require.resolve('requirex/cache') or os.tmpdir()

export class Cache {

	constructor(private loader: Loader) {
		if(!features.isNode && typeof (window) == 'object') {
			this.storage = window.localStorage;
		}
	}

	fetchStorage(resolvedKey: string, options: FetchOptions, isHead?: boolean) {
		const storage = this.storage;
		const metaKey = prefixMeta + resolvedKey;
		let fetched: Promise<FetchResponse> | undefined;
		let meta: CacheMeta | null | undefined;

		if(storage) {
			while(1) {
				meta = JSON.parse(storage.getItem(prefixMeta + resolvedKey) || 'null');
				if(meta && meta.url != resolvedKey) {
					resolvedKey = meta.url;
				} else break;
			}

			if(meta) {
				let text = isHead || !meta.ok ? '' : storage.getItem(prefixText + meta.url);

				if(text || text === '') {
					fetched = Promise.resolve(new FetchResponse(
						meta.status,
						meta.url,
						meta.headers,
						text
					));
				}
			}
		}

		return fetched || fetch(resolvedKey, options).then((res: FetchResponse) => {
			if(storage) {
				const headers: FetchHeaders = {};

				res.headers.forEach((value, name) => headers[name] = value);

				meta = {
					ok: res.ok,
					status: res.status,
					url: res.url,
					stamp: new Date().getTime(),
					headers
				};

				const data = JSON.stringify(meta);
				storage.setItem(metaKey, data);
				storage.setItem(prefixMeta + meta.url, data);

				if(!isHead) {
					res.text().then((text: string) => {
						// Avoid filling localStorage quota with large files.
						// Better latency from caching many small files is more important.
						if(text.length < 500000) {
							storage.setItem(prefixText + meta!.url, text);
						}
					});
				}
			}

			return res;
		});
	}

	fetch(resolvedKey: string, options?: FetchOptions) {
		options = options || {};
		const isHead = options.method == 'HEAD';

		let fetched = this.dataTbl[resolvedKey] || (isHead && this.headTbl[resolvedKey]);

		if(!fetched) {
			// TODO: Avoid caching files from current domain unless they are
			// inside npm packages. Otherwise maybe bust browser cache?
			// Also try to support boennemann/alle somehow...

			/* const pos = skipSlashes(resolvedKey, 0, 3);
			let origin = pos > 0 && resolvedKey.substr(0, pos);

			if(origin != this.origin) {
				// ...
			} */

			if(this.storage) {
				fetched = this.fetchStorage(resolvedKey, options, isHead);
			} else {
				fetched = fetch(resolvedKey, options);
			}

			(isHead ? this.headTbl : this.dataTbl)[resolvedKey] = fetched;
		}

		return fetched;
	}

	updateMeta(resolvedKey: string, format: string, deps: string[], sourceCode?: string) {
		// ...
	}

	origin: string | false;
	storage?: Storage;

	headTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};
	dataTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};

}
