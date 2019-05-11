import { Record } from '../Record';
import { Loader, LoaderConfig } from '../LoaderBase';

/** CSS loader plugin. */

export class CSS extends Loader {

	// constructor(config?: LoaderConfig) {}

	instantiate(record: Record) {
		if(typeof document != 'object' || !document.createElement) return;
		const head = document.getElementsByTagName('head')[0];

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
