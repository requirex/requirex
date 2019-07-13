import * as FS from 'fs';
import * as HTTP from 'http';

import { URL } from './URL';
import { features, nodeRequire, keys, assign } from './platform';

export interface FetchOptions {
	method?: string;
}

export type FetchHeaders = { [key: string]: string };

/** Subset of a WhatWG fetch response relevant for script loaders. */

export class FetchResponse {
	constructor(
		public status: number | undefined,
		public url: string,
		private _headers: FetchHeaders,
		private _text?: string | false
	) {
		this.ok = status == 200;
	}

	text() {
		return Promise.resolve(this._text || '');
	}

	ok: boolean;
	headers = {
		get: (name: string) => this._headers[name],
		forEach: (handler: (value: string, name: string) => void, self?: any) => {
			const headers = this._headers;

			for(let name of keys(headers)) {
				handler.call(self, headers[name], name);
			}
		}
	};
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

function parseHeadersXHR(headers: string) {
	const result: FetchHeaders = {};

	for(let header of headers.replace(/\r?\n[\t ]+/g, ' ').split(/\r?\n/)) {
		const match = header.match(/\s*([^:]+):\s*(.*)/);

		if(match) {
			const key = match[1].toLowerCase();
			const prev = result[key];
			result[key] = (prev ? prev + ', ' : '') + match[2];
		}
	}

	return result;
}

function parseHeadersNode(headers: HTTP.IncomingHttpHeaders) {
	const result: FetchHeaders = {};

	for(let name of keys(headers)) {
		const key = name.toLowerCase();
		const prev = result[key];
		result[key] = (prev ? prev + ', ' : '') + headers[name];
	}

	return result;
}

function nodeFetchFile(
	key: string,
	isHead: boolean | undefined,
	resolve: (result: FetchResponse | Promise<FetchResponse>) => void,
	reject: (err: any) => void
) {
	let status = 200;

	function handleErr<Type>(handler?: (data: Type) => void) {
		return (err: NodeJS.ErrnoException | null, data: Type) => {
			if(err) {
				status = nodeErrors[err.code!];
				if(!status) return reject(err);
			} else if(data && handler) {
				data = handler(data) as any;
			}

			resolve(new FetchResponse(status, key, {}, data as any));
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

		assign(parsed, options);

		const req = http.request(parsed, (res: HTTP.IncomingMessage) => {
			function finish(data?: string) {
				resolve(new FetchResponse(
					res.statusCode,
					key,
					parseHeadersNode(res.headers),
					data
				));
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

export function fetch(key: string, options?: FetchOptions) {
	options = options || {};

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
						parseHeadersXHR(xhr.getAllResponseHeaders()),
						xhr.status == 200 && xhr.responseText
					));
				}
			};

			xhr.open(options!.method || 'GET', key, true);
			xhr.send();
		}
	);
}
