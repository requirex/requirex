import { Record } from '../Record';
import { Loader, LoaderConfig } from '../LoaderBase';

/** JSON loader plugin. */

export class Json extends Loader {

	// constructor(config?: LoaderConfig) {}

	instantiate(record: Record) {
		return(JSON.parse(record.sourceCode));
	}

}
