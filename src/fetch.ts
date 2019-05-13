import * as FS from 'fs';
import * as HTTP from 'http';

import { URL } from './URL';
import { features, nodeRequire } from './platform';

/** Subset of a WhatWG fetch response relevant for script loaders. */

export class FetchResponse {
	constructor(
		public status: number | undefined,
		public url: string,
		private getHeader: (name: string) => string | null | undefined,
		private data?: string | false
	) {
		this.ok = status == 200;
	}

	text() {
		return Promise.resolve(this.data || '');
	}

	ok: boolean;
	headers = { get: this.getHeader };
}

/** Table of HTTP status codes redirecting the client to another URL. */

export const redirectCodes: { [code: number]: boolean } = {
	301: true,
	302: true,
	303: true,
	307: true,
	308: true
};

const nodeErrors: { [name: string]: number } = {
	EACCES: 403,
	EISDIR: 403,
	ENOENT: 404,
	EPERM: 403
};

const empty: { [name: string]: string } = {};

function nodeHeaders(headers?: HTTP.IncomingHttpHeaders) {
	return (name: string) => {
		const value = (headers || empty)[name.toLowerCase()];
		return value && (
			typeof value == 'string' ? value : value.join(',')
		);
	}
}

function nodeFetchFile(
	key: string,
	isHead: boolean | undefined,
	resolve: (result: FetchResponse | Promise<FetchResponse>) => void,
	reject: (err: any) => void
) {
	let status = 200;
	let text: string | undefined;

	function handleErr<Type>(handler?: (data: Type) => void) {
		return (err: NodeJS.ErrnoException | null, data: Type) => {
			if(err) {
				status = nodeErrors[err.code!];
				if(!status) return reject(err);
			} else if(data && handler) {
				data = handler(data) as any;
			}

			resolve(new FetchResponse(status, key, nodeHeaders(), data as any));
		};
	}

	const fs: typeof FS = nodeRequire('fs');
	const path = URL.toLocal(key);

	if(isHead) {
		fs.stat(path, handleErr((stat: FS.Stats) => {
			if(!stat.isFile()) status = 403;
		}));
	} else {
		fs.readFile(path, 'utf-8', handleErr());
	}
}

export function nodeFetch(key: string, options: HTTP.RequestOptions, ttl = 3) {
	return new Promise((
		resolve: (result: FetchResponse | Promise<FetchResponse>) => void,
		reject: (err: any) => void
	) => {
		if(!ttl) {
			return reject(new Error('Too many redirects'));
		}

		const proto = key.substr(0, key.indexOf('://')).toLowerCase();
		const isHead = options.method == 'HEAD';

		if(proto == 'file') {
			return nodeFetchFile(key, isHead, resolve, reject);
		} else if(proto != 'http' && proto != 'https') {
			return reject(new Error('Unsupported protocol ' + proto));
		}

		const http: typeof HTTP = nodeRequire(proto);
		const parsed: HTTP.RequestOptions = nodeRequire('url').parse(key);

		for(let key in options) {
			if(options.hasOwnProperty(key)) {
				(parsed as any)[key] = (options as any)[key];
			}
		}

		const req = http.request(parsed, (res: HTTP.IncomingMessage) => {
			function finish(data?: string) {
				resolve(new FetchResponse(res.statusCode, key, nodeHeaders(res.headers), data));
			}

			if(res.statusCode == 200) {
				if(isHead) {
					req.abort();
					return finish();
				}

				const chunkList: Buffer[] = [];

				res.on('error', reject);
				res.on('data', (chunk: Buffer) => chunkList.push(chunk));
				res.on('end', () => {
					finish(Buffer.concat(chunkList).toString('utf-8'));
				});
			} else if(!res.statusCode || !redirectCodes[res.statusCode]) {
				req.abort();
				finish();
			} else {
				const next = res.headers.location;

				req.abort();
				if(!next) return reject(res);

				resolve(nodeFetch(URL.resolve(key, next), options, ttl - 1));
			}
		});

		req.on('error', reject);
		req.end();
	});
}

/** Partial WhatWG fetch implementation for script loaders. */

export function fetch(key: string, options?: { method?: string }) {
	options = options || {};
	console.log('FETCH', options.method, key);

	return features.isNode ? nodeFetch(key, options) : new Promise(
		(
			resolve: (result: FetchResponse) => void,
			reject: (err: any) => void
		) => {
			const xhr = new XMLHttpRequest();

			xhr.onerror = reject;
			xhr.onload = () => {
				if(xhr.readyState == 4) {
					resolve(new FetchResponse(
						xhr.status,
						xhr.responseURL || key,
						(name: string) => xhr.getResponseHeader(name),
						xhr.status == 200 && xhr.responseText
					));
				}
			};

			xhr.open(options!.method || 'GET', key, true);
			xhr.send();
		}
	);
}
