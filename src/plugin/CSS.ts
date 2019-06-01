import { Record } from '../Record';
import { LoaderPlugin } from '../Loader';
import { getTags } from '../platform';

/** CSS loader plugin. */

export class CSS implements LoaderPlugin {

	instantiate(record: Record) {
		if(!getTags) return;
		const head = getTags('head')[0];

		// Inject as a style element if transpiled.
		// Relative URLs must be fixed by the transpiler.
		// const element = document.createElement('style');
		const element = document.createElement('link');
		element.type = 'text/css';
		// element.innerHTML = record.sourceCode;
		element.rel = 'stylesheet';
		element.href = record.resolvedKey;

		head.appendChild(element);
	}

}
