import { Record } from '../Record';
import { Loader, LoaderConfig } from '../LoaderBase';

/** JSON loader plugin. */

export class Json extends Loader {

	// constructor(config?: LoaderConfig) {}

	instantiate(record: Record) {
		return(record.compiled || JSON.parse(record.sourceCode));
	}

	wrap(record: Record) {
		return(record.sourceCode);
	}

}
