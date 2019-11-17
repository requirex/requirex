import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

/** JSON loader plugin. */

export class Json implements LoaderPlugin {

	instantiate(record: Record) {
		return record.compiled || (record.sourceCode && JSON.parse(record.sourceCode));
	}

	wrap(record: Record) {
		return record.sourceCode || 'null';
	}

}
