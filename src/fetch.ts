import * as FS from 'fs';
import * as HTTP from 'http';

import { URL } from './URL';
import { isNode, nodeRequire } from './platform';

/** Subset of a WhatWG fetch response relevant for script loaders. */

export class FetchResponse {
	constructor(
		public url: string,
		private data: string,
		private getHeader: (name: string) => string | null | undefined
	) {}

	text() {
		return(Promise.resolve(this.data));
	}

	ok: boolean;
	headers = { get: this.getHeader };
}

FetchResponse.prototype.ok = true;

/** Table of HTTP status codes redirecting the client to another URL. */

export const redirectCodes: { [code: number]: boolean } = {
	301: true,
	302: true,
	303: true,
	307: true,
	308: true
}

export interface NodeResponse {
	text: string;
	uri: string;
	headers?: HTTP.IncomingHttpHeaders;
}

export function nodeRequest(uri: string, options?: HTTP.RequestOptions, ttl = 3) {
	const response: NodeResponse = {
		text: '',
		uri
	};

	const result = new Promise((
		resolve: (result: NodeResponse | Promise<NodeResponse>) => void,
		reject: (err: any) => void
	) => {
		if(!ttl) reject(new Error('Too many redirects'));

		const proto = uri.substr(0, uri.indexOf('://')).toLowerCase();
		const isHead = options && options.method == 'HEAD';

		if(proto == 'file') {
			const fs: typeof FS = nodeRequire('fs');
			const path = URL.toLocal(uri);

			if(isHead) {
				return(fs.stat(
					path,
					(err: NodeJS.ErrnoException | null, stat: FS.Stats) => (
						err ? reject(err) : resolve(response)
					)
				));
			} else {
				return(fs.readFile(
					path,
					'utf-8',
					(err: NodeJS.ErrnoException | null, text: string) => (
						err ? reject(err) : (response.text = text, resolve(response))
					)
				));
			}
		} else if(proto != 'http' && proto != 'https') {
			return(reject(new Error('Unsupported protocol ' + proto)));
		}

		const http: typeof HTTP = nodeRequire(proto);
		const parsed: HTTP.RequestOptions = nodeRequire('url').parse(uri);

		for(let key in options || {}) {
			if(options!.hasOwnProperty(key)) {
				(parsed as any)[key] = (options as any)[key];
			}
		}

		const req = http.request(parsed, (res: HTTP.IncomingMessage) => {
			if(res.statusCode == 200) {
				response.headers = res.headers;

				if(isHead) {
					req.abort();
					return(resolve(response));
				}

				const chunkList: Buffer[] = [];

				res.on('error', reject);
				res.on('data', (chunk: Buffer) => chunkList.push(chunk));
				res.on('end', () => {
					response.text = Buffer.concat(chunkList).toString('utf-8');
					resolve(response);
				});
			} else if(!res.statusCode || !redirectCodes[res.statusCode]) {
				req.abort();
				return(reject(new Error(
					res.statusCode + ' ' + res.statusMessage +
					'\n    fetching ' + uri
				)));
			} else {
				const next = res.headers.location;

				req.abort();
				if(!next) return(reject(res));

				resolve(nodeRequest(URL.resolve(uri, next), options, ttl - 1));
			}
		});

		req.on('error', reject);
		req.end();
	});

	return(result);
}

const empty: { [name: string]: string } = {};

/** Partial WhatWG fetch implementation for script loaders. */

export function fetch(uri: string, options?: { method?: string }) {
	const result = isNode ? (
		nodeRequest(uri, options).then(({ text, uri, headers }) => new FetchResponse(
			uri,
			text,
			(name: string) => {
				const value = (headers || empty)[name.toLowerCase()];
				return(value && (typeof(value) == 'string' ? value : value.join(',')));
			}
		))
	) : new Promise(
		(
			resolve: (result: FetchResponse) => void,
			reject: (err: any) => void
		) => {
			const xhr = new XMLHttpRequest();

			xhr.onerror = reject;
			xhr.onload = () => {
				if(xhr.readyState != 4) return;

				if(xhr.status != 200) {
					reject(xhr);
				} else {
					resolve(new FetchResponse(
						xhr.responseURL || uri,
						xhr.responseText,
						(name: string) => xhr.getResponseHeader(name)
					));
				}
			};

			xhr.open((options && options.method) || 'GET', uri, true);
			xhr.send();
		}
	);

	return(result);
}
