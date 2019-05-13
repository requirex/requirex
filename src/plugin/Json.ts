import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

/** JSON loader plugin. */

export const Json = (loader: Loader): LoaderPlugin => {

	function instantiate(record: Record) {
		return record.compiled || JSON.parse(record.sourceCode);
	}

	function wrap(record: Record) {
		return record.sourceCode;
	}

	return { instantiate, wrap };

};
