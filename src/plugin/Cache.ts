import { fetch, FetchOptions, FetchHeaders, FetchResponse } from '../fetch';
import { Record, ModuleFormat } from '../Record';
import { skipSlashes } from '../URL';
import { Loader } from '../Loader';
import { features, origin } from '../platform';

const nodeModules = '/node_modules/';

const prefixMeta = 'requirex:meta:';
const prefixText = 'requirex:text:';
const prefixTrans = 'requirex:transpiled:';

export interface CacheMeta {
	ok: boolean;
	status?: number;
	url: string;
	stamp: number;
	headers: FetchHeaders;
	format?: ModuleFormat;
	deps?: string[];
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

	store(resolvedKey: string, res?: FetchResponse, isHead?: boolean) {
		const storage = this.storage;
		const finalKey = (res && res.url) || resolvedKey;

		if(storage) {
			if(!this.metaTbl[resolvedKey] || !this.metaTbl[finalKey]) {
				const meta = JSON.parse(
					storage.getItem(prefixMeta + resolvedKey) ||
					storage.getItem(prefixMeta + finalKey) ||
					'null'
				);

				this.metaTbl[resolvedKey] = meta;
				this.metaTbl[finalKey] = meta;
				this.textTbl[finalKey] = storage.getItem(prefixText + finalKey);
			}

			let ok = true;
			let status: number | undefined;
			const headers: FetchHeaders = {};

			if(res) {
				ok = res.ok;
				status = res.status;
				res.headers.forEach((value, name) => headers[name] = value);
			}

			const meta: CacheMeta = {
				ok,
				status,
				url: finalKey,
				stamp: new Date().getTime(),
				headers
			};

			const data = JSON.stringify(meta);

			// Store metadata using both original and possibly redirected URL.
			storage.setItem(prefixMeta + resolvedKey, data);
			storage.setItem(prefixMeta + meta.url, data);

			if(res && !isHead) {
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

	fetchRemote(
		resolvedKey: string,
		options: FetchOptions,
		bust: string,
		isHead: boolean | undefined
	) {
		// console.log('fetchRemote', resolvedKey);
		const key = resolvedKey + (
			bust && (resolvedKey.indexOf('?') >= 0 ? '&' : '?') + bust
		);

		return fetch(key, options).then((res: FetchResponse) => {
			if(bust) {
				const old = res;

				// Remove cache bust parameter while working around read-only
				// url property in native fetch.
				res = subClone(old);

				res.url = old.url.replace(
					new RegExp('([&?])' + bust + '(&?)'),
					(match: string, before: string, after: string) => after && before
				);
			}

			return this.store(resolvedKey, res, isHead)!;
		});
	}

	fetchStorage(resolvedKey: string, options: FetchOptions, bust: string, isHead?: boolean) {
		// console.log('fetchStorage', resolvedKey);
		const originalKey = resolvedKey;
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

					this.metaTbl[originalKey] = meta;
					this.metaTbl[resolvedKey] = meta;
					this.textTbl[resolvedKey] = text;

					fetched = Promise.resolve(res);
				}
			}
		}

		return fetched || this.fetchRemote(resolvedKey, options, bust, isHead);
	}

	isLocal(resolvedKey: string) {
		const local = origin || this.loader.firstParent;

		if(!this.storage || !local) return false;

		const posOrigin = skipSlashes(resolvedKey, 0, 3);
		const posModules = resolvedKey.lastIndexOf(nodeModules);

		return (
			posOrigin > 0 &&
			resolvedKey.substr(0, posOrigin) == (local + '/').substr(0, posOrigin) && (
				posModules < 0 ||
				this.loader.modulesBustTbl[resolvedKey.substr(0, posModules + nodeModules.length)]
			)
		);
	}

	fetch(resolvedKey: string, options?: FetchOptions) {
		// console.log('fetch', resolvedKey);
		options = options || {};
		const isHead = options.method == 'HEAD';

		let fetched = this.dataTbl[resolvedKey] || (isHead && this.headTbl[resolvedKey]);

		if(!fetched) {
			let bust = '';
			let develop = this.isLocal(resolvedKey);

			// Avoid caching files from current domain unless they are inside
			// npm packages.

			if(develop) {
				// Bust browser cache.
				bust = 'RequirexCacheBust=' + Math.random();
			}

			if(this.storage && !develop) {
				fetched = this.fetchStorage(resolvedKey, options, bust, isHead);
			} else {
				fetched = this.fetchRemote(resolvedKey, options, bust, isHead);
			}

			(isHead ? this.headTbl : this.dataTbl)[resolvedKey] = fetched;
		}

		return fetched;
	}

	fetchRecord(record: Record) {
		let fetched: Promise<string>;
		const storage = this.storage;

		// TODO: Get old source code from cache before updating it after a remote fetch,
		// then compare old and new version and if they are identical, re-use old metadata
		// and transpiled code.

		if(record.sourceCode) {
			if(storage && !this.dataTbl[record.resolvedKey]) {
				this.store(record.resolvedKey);
				storage.setItem(prefixText + record.resolvedKey, record.sourceCode);
			}
			fetched = Promise.resolve(record.sourceCode);
		} else {
			fetched = this.loader.fetch(record.resolvedKey).then((res: FetchResponse) => {
				if(res.url) record.resolvedKey = res.url;
				return res.text();
			});
		}

		return fetched.then((text: string) => {
			let meta: CacheMeta | undefined = this.metaTbl[record.resolvedKey];
			// console.log('FETCHED', record.resolvedKey, meta, text == this.textTbl[record.resolvedKey]);

			if(storage && meta && text == this.textTbl[record.resolvedKey]) {
				const trans = storage.getItem(prefixTrans + record.resolvedKey);

				if(trans) {
					record.format = meta.format || record.format;
					record.depList = meta.deps || [];
					text = trans;
					// console.log('CACHE', record.format, text.substr(0, 100));
				}
			}

			record.sourceCode = text;
		});
	}

	update(record: Record) {
		const storage = this.storage;
		const text = record.sourceCode;

		if(storage && text && text.length < 500000) {
			const metaKey = prefixMeta + record.resolvedKey;
			const meta: CacheMeta = JSON.parse(storage.getItem(metaKey) || 'null');
			if(!meta) return;

			meta.format = record.format;
			meta.deps = record.depList;

			// TODO: Maybe call a hook in the format plugin so it can store
			// any additional metadata.

			const data = JSON.stringify(meta);
			storage.setItem(metaKey, data);
			storage.setItem(prefixTrans + record.resolvedKey, text);
		}
	}

	storage?: Storage;

	headTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};
	dataTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};

	metaTbl: { [resolvedKey: string]: CacheMeta } = {};
	textTbl: { [resolvedKey: string]: string | null } = {};

}
