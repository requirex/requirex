import { fetch, FetchOptions, FetchHeaders, FetchResponse } from '../fetch';
import { Record, ModuleFormat } from '../Record';
import { skipSlashes } from '../URL';
import { Loader } from '../Loader';
import { features, origin } from '../platform';

const nodeModules = '/node_modules/';

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

declare module '../fetch' {
	interface FetchResponse {
		cacheMeta?: CacheMeta;
	}
}

function subClone<Type extends Object>(obj: Type): Type {
	function Child() {}
	Child.prototype = obj;

	return new (Child as any)();
}

// TODO: Storage "polyfill" for Node, using require.resolve('requirex/cache') or os.tmpdir()

export class Cache {

	constructor(private loader: Loader) {
		if(!features.isNode && typeof (window) == 'object') {
			this.storage = window.localStorage;
		}
	}

	store(metaKey: string, res: FetchResponse, isHead?: boolean) {
		const storage = this.storage;

		if(storage) {
			const headers: FetchHeaders = {};

			res.headers.forEach((value, name) => headers[name] = value);

			const meta = {
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
	}

	fetchRemote(resolvedKey: string, options: FetchOptions, bust: string, isHead?: boolean) {
		const key = resolvedKey + (
			bust && (resolvedKey.indexOf('?') >= 0 ? '&' : '?') + bust
		);

		return fetch(key, options).then((res: FetchResponse) => {
			let result = res;

			if(bust) {
				// Remove cache bust parameter, work around read-only url
				// property in native fetch.
				result = subClone(res);

				result.url = res.url.replace(
					new RegExp('([&?])' + bust + '(&?)'),
					(match: string, before: string, after: string) => after && before
				);
			}

			if(this.storage) {
				this.store(prefixMeta + resolvedKey, result, isHead);
			}

			return result;
		});
	}

	fetchStorage(resolvedKey: string, options: FetchOptions, bust: string, isHead?: boolean) {
		const storage = this.storage;
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
					const res = new FetchResponse(
						meta.status,
						meta.url,
						meta.headers,
						text
					);

					res.cacheMeta = meta;
					fetched = Promise.resolve(res);
				}
			}
		}

		return fetched || this.fetchRemote(resolvedKey, options, bust, isHead);
	}

	fetch(resolvedKey: string, options?: FetchOptions) {
		options = options || {};
		const isHead = options.method == 'HEAD';

		let fetched = this.dataTbl[resolvedKey] || (isHead && this.headTbl[resolvedKey]);

		if(!fetched) {
			let useStorage = !!this.storage;
			let bust = '';
			const loader = this.loader;
			const local = origin || loader.firstParent;

			// Avoid caching files from current domain unless they are inside
			// npm packages.

			if(useStorage && local) {
				const posOrigin = skipSlashes(resolvedKey, 0, 3);
				const posModules = resolvedKey.lastIndexOf(nodeModules);

				if(posOrigin > 0 &&
					resolvedKey.substr(0, posOrigin) == (local + '/').substr(0, posOrigin) && (
						posModules < 0 ||
						loader.modulesBustTbl[resolvedKey.substr(0, posModules + nodeModules.length)]
					)
				) {
					useStorage = false;
					// Bust browser cache.
					bust = 'RequirexCacheBust=' + Math.random();
				}
			}

			if(useStorage) {
				fetched = this.fetchStorage(resolvedKey, options, bust, isHead);
			} else {
				fetched = this.fetchRemote(resolvedKey, options, bust, isHead);
			}

			(isHead ? this.headTbl : this.dataTbl)[resolvedKey] = fetched;
		}

		return fetched;
	}

	fetchRecord(record: Record) {
		return this.loader.fetch(record.resolvedKey).then((res: FetchResponse) => {
			const meta = res.cacheMeta;

			if(meta) {
				// record.format = meta.format || record.format;
			} else {
				// TODO: Compare with cache, try to get meta if unchanged.
			}

			return res.text();
		}).then((text: string) => {
			record.sourceCode = text;
		});
	}

	updateMeta(resolvedKey: string, format: string, deps: string[], sourceCode?: string) {
		// ...
	}

	storage?: Storage;

	headTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};
	dataTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};

}
