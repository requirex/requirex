import { Record } from '../Record';
import { Loader, LoaderConfig } from '../LoaderBase';

/** Text loader plugin. */

export class Text extends Loader {

	// constructor(config?: LoaderConfig) {}

	instantiate(record: Record) {
		return(record.compiled || record.sourceCode);
	}

	wrap(record: Record) {
		return(JSON.stringify(record.sourceCode));
	}

}
