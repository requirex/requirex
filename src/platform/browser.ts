import { slice } from './util';
import { features } from './features';

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
