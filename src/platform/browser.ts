import { slice } from './util';
import { features } from './features';
import { globalEnv } from './global';

/** Get all elements by tag name.
  *
  * @param name Tag name to search for.
  * @param document Document object to query.
  * If omitted, use the global document.
  *
  * @return Array of results (empty if the operation was unsupported). */

export function getTags(name: string, doc?: Document | false) {
	doc = doc || features.doc;
	const method = doc && doc.getElementsByTagName;

	return method ? slice.call(method.call(doc, name)) : [];
}

export const location = (typeof self == 'object' && globalEnv.location == self.location && self.location);

/** Portable replacement for location.origin. */
export const origin = (location ? (
	location.protocol + '//' +
	location.hostname +
	(location.port ? ':' + location.port : '')
) : ''
);
