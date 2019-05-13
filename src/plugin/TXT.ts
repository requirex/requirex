import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

/** Text loader plugin. */

export const TXT = (loader: Loader): LoaderPlugin => {

	function instantiate(record: Record) {
		return record.compiled || record.sourceCode;
	}

	function wrap(record: Record) {
		return JSON.stringify(record.sourceCode);
	}

	return { instantiate, wrap };

};
