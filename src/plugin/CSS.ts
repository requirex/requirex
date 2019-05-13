import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';

/** CSS loader plugin. */

export const CSS = (loader: Loader): LoaderPlugin => {

	function instantiate(record: Record) {
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

	return { instantiate };

};
