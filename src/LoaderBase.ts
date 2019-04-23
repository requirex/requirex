import { URL } from './URL';
import { Record } from './Record';
import { isNode, origin, nodeRequire } from './platform';
import { Loader as L } from './Loader';

/** Fake Loader class inherited by plugins for correct typings. */

export const Loader: typeof L = class {} as any;
export declare const loader: L;
export type Loader = typeof loader;

export interface LoaderConfig {
	baseURL?: string;
	plugins?: { [name: string]: Loader };
	registry?: { [name: string]: any };
}

export interface SystemDeclaration {
	setters?: ((val: any) => void)[];
	execute?: () => any;
	exports?: any;
}

/** Convert URL to a local path. Strip protocol and possible origin,
  * use backslahes in file system paths on Windows. */

export function getLocal(resolvedKey: string) {
	if(resolvedKey.match(/^file:/)) {
		return(URL.toLocal(resolvedKey));
	}

	if(origin && resolvedKey.substr(0, origin.length) == origin) {
		return(resolvedKey.substr(origin.length));
	}

	return(resolvedKey);
}

/** Strip query string, hash, last slash in path and anything after it
  * to get the directory part of a path or address. **/

export function getDir(key: string) {
	return(key.replace(/(\/[^/#?]*)?([#?].*)?$/, ''));
}
