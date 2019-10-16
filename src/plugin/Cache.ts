import { FetchOptions, FetchHeaders, FetchResponse } from '../fetch';
import { Record, ModuleFormat } from '../Record';
import { skipSlashes } from '../URL';
import { Loader } from '../Loader';
import { SourceMap } from '../SourceMap';
import { features, origin } from '../platform';

const nodeModules = '/node_modules/';

/** Metadata stored for every cached file. */

export interface CacheMeta {
	/** HTTP(S) fetch result success flag. */
	ok: boolean;
	/** HTTP status code. */
	status?: number;
	/** Response URL (including possible redirection). */
	url: string;
	/** Timestamp when the file was fetched, for future use. */
	stamp: number;
	/** HTTP response headers, for future use. */
	headers: FetchHeaders;
	/** JavaScript module format reported by later discovery step. */
	format?: ModuleFormat;
	/** Dependencies reported by later discovery step. */
	deps?: string[];
}

/** Clone an object without invoking getters, by subclassing it.
  * Allows setting custom properties on internal objects. */

function subClone<Type extends Object>(obj: Type): Type {
	function Child() {}
	Child.prototype = obj;

	return new (Child as any)();
}

/** Type of information associated with a URL, forming with it the key
  * of a stored key-value pair. */

const enum StoreKind {
	META = 0,
	SOURCE,
	TRANSPILED,
	SOURCEMAP
}

/** String tags for types of information attached to URLs, appended to them
  * to form unique keys for each URL and type combination. */

const storeKind = ['meta', 'source', 'transpiled', 'sourcemap'];

/** Build a unique key for a URL and type of information attached to it. */

function buildKey(kind: StoreKind, key: string) {
	return key.replace(/#.*/, '') + '!' + storeKind[kind];
}

/** Generic low level storage interface used by the cache. */

interface Store {
	read(kind: StoreKind, key: string): Promise<string>;
	write(kind: StoreKind, key: string, data: string): void;
}

/** CacheStorage-based low level API (useful also outside service workers,
  * likely allows using more space than localStorage). */

class CacheStore implements Store {

	constructor() {
		this.ready = window.caches.open('RequireX');
	}

	read(kind: StoreKind, key: string) {
		const result = this.ready.then(
			(cache) => cache.match(buildKey(kind, key))
		).then(
			(res) => res ? res.text() : Promise.reject(res)
		);

		return result;
	}

	write(kind: StoreKind, key: string, data: string) {
		this.ready.then((cache) => {
			cache.put(buildKey(kind, key), new Response(data))
		});
	}

	ready: Promise<Cache>;

}

/** localStorage-based low level API with wide browser support. */

class LocalStore implements Store {

	constructor() {
		this.storage = window.localStorage;
	}

	read(kind: StoreKind, key: string) {
		const result = this.storage.getItem('requirex:' + buildKey(kind, key));
		return result === null ? Promise.reject(result) : Promise.resolve(result);
	}

	write(kind: StoreKind, key: string, data: string) {
		// Avoid filling localStorage quota with large files.
		// Better latency from caching many small files is more important.
		if(data.length < 500000) {
			this.storage.setItem('requirex:' + buildKey(kind, key), data);
		}
	}

	storage: Storage;

}

/** Follow all redirects for a URL in low level metadata storage. */

function checkRedirect(storage: Store, resolvedKey: string): Promise<CacheMeta | string> {
	return storage.read(StoreKind.META, resolvedKey).then((data) => {
		const meta = JSON.parse(data);

		if(meta && meta.url != resolvedKey) return checkRedirect(storage, meta.url);
		return meta;
	}).catch(() => resolvedKey);
}

// TODO: Storage "polyfill" for Node, using require.resolve('requirex/cache') or os.tmpdir()
// class NodeStore {}

export class FetchCache {

	constructor(private loader: Loader) {
		if(features.isNode) {
			// this.storage = new NodeStore();
		} else if(typeof window == 'object') {
			if(typeof window.caches == 'object') {
				this.storage = new CacheStore();
			} else if(typeof window.localStorage == 'object') {
				this.storage = new LocalStore();
			}
		}
	}

	store(resolvedKey: string): Promise<undefined>;
	store(resolvedKey: string, res: FetchResponse, isHead?: boolean): Promise<FetchResponse>;
	store(resolvedKey: string, res?: FetchResponse, isHead?: boolean) {
		const storage = this.storage;
		if(!storage) return Promise.resolve(res);

		const finalKey = (res && decodeURI(res.url)) || resolvedKey;

		const snapshotReady = (
			this.metaTbl[resolvedKey] || this.metaTbl[finalKey] ?
			Promise.resolve(res) : (
				storage.read(StoreKind.META, resolvedKey).catch(
					() => storage.read(StoreKind.META, finalKey)
				).then((data) => {
					const meta = JSON.parse(data);
					this.metaTbl[resolvedKey] = meta;
					this.metaTbl[finalKey] = meta;

					return storage.read(StoreKind.SOURCE, finalKey);
				}).then((text) => {
					this.textTbl[finalKey] = text;
					return res;
				}).catch(() => res)
			)
		);

		snapshotReady.then(() => {
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
			storage.write(StoreKind.META, resolvedKey, data);
			storage.write(StoreKind.META, meta.url, data);

			if(res && !isHead) {
				res.text().then((text: string) => {
					storage.write(StoreKind.SOURCE, meta!.url, text);
				});
			}
		});

		return snapshotReady;
	}

	fetchRemote(
		resolvedKey: string,
		options: FetchOptions,
		bust: string,
		isHead: boolean | undefined
	) {
		const key = resolvedKey + (
			bust && (resolvedKey.indexOf('?') >= 0 ? '&' : '?') + bust
		);

		return features.fetch(key, options).then((res: FetchResponse) => {
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
		const originalKey = resolvedKey;
		const storage = this.storage;
		let fetched: Promise<FetchResponse | null>;
		let meta: CacheMeta | null | undefined;

		if(storage) {
			fetched = checkRedirect(storage, resolvedKey).then((result) => {
				if(typeof result == 'string') {
					resolvedKey = result;
					return null;
				}

				meta = result;
				if(meta.url) resolvedKey = meta.url;

				return (
					isHead || !meta.ok ? '' :
					storage.read(StoreKind.SOURCE, meta.url)
				) as Promise<string | null> | string;
			}).then((text) => {
				if(!meta || !(text || text === '')) return null;

				const res = new FetchResponse(
					meta.status,
					meta.url,
					meta.headers,
					text
				);

				this.metaTbl[originalKey] = meta;
				this.metaTbl[resolvedKey] = meta;
				this.textTbl[resolvedKey] = text;

				return res;
			}).catch(
				() => null
			);
		} else {
			fetched = Promise.resolve(null);
		}

		return fetched.then((res) =>
			res || this.fetchRemote(resolvedKey, options, bust, isHead)
		);
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

		if(record.sourceCode) {
			if(storage && !this.dataTbl[record.resolvedKey]) {
				fetched = this.store(record.resolvedKey).then(() => {
					storage.write(StoreKind.SOURCE, record.resolvedKey, record.sourceCode)
					return record.sourceCode;
				});
			} else {
				fetched = Promise.resolve(record.sourceCode);
			}
		} else {
			fetched = this.loader.fetch(record.resolvedKey).then((res: FetchResponse) => {
				if(res.url) record.resolvedKey = decodeURI(res.url);
				return res.text();
			});
		}

		return fetched.then((text: string) => {
			const meta: CacheMeta | undefined = this.metaTbl[record.resolvedKey];

			record.sourceCode = text;

			// After remote fetch, compare cached and new version.
			// If they are identical, re-use old metadata and transpiled code.

			if(storage && meta && text == this.textTbl[record.resolvedKey]) {
				return Promise.all([
					storage.read(StoreKind.TRANSPILED, record.resolvedKey).catch(() => {}),
					storage.read(StoreKind.SOURCEMAP, record.resolvedKey).catch(() => {})
				]).then(([trans, map]) => {
					if(trans) {
						record.format = meta!.format || record.format;
						record.depList = meta!.deps || [];
						record.sourceCode = trans;

						if(map) record.sourceMap = new SourceMap(record.resolvedKey, map);
					}
				});
			}
		});
	}

	update(record: Record) {
		const storage = this.storage;
		const text = record.sourceCode;

		if(storage && text) {
			storage.read(StoreKind.META, record.resolvedKey).then((data: string) => {
				const meta: CacheMeta = JSON.parse(data);

				meta.format = record.format;
				meta.deps = record.depList;

				// TODO: Maybe call a hook in the format plugin so it can store
				// any additional metadata.

				storage.write(StoreKind.META, record.resolvedKey, JSON.stringify(meta));
				storage.write(StoreKind.TRANSPILED, record.resolvedKey, text);
			}).catch(() => {});

			if(record.sourceMap) {
				storage.write(
					StoreKind.SOURCEMAP,
					record.resolvedKey,
					JSON.stringify(record.sourceMap.json)
				);
			}
		}
	}

	storage: Store;

	headTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};
	dataTbl: { [resolvedKey: string]: Promise<FetchResponse> } = {};

	metaTbl: { [resolvedKey: string]: CacheMeta } = {};

	/* Old source code from cache, from before fetching updates. */
	textTbl: { [resolvedKey: string]: string | null } = {};

}
