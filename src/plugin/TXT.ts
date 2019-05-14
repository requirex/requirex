import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

/** Text loader plugin. */

export class TXT implements LoaderPlugin {

	instantiate(record: Record) {
		return record.compiled || record.sourceCode;
	}

	wrap(record: Record) {
		return JSON.stringify(record.sourceCode);
	}

}
