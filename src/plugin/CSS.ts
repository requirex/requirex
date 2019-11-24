import { Record } from '../Record';
import { LoaderPlugin } from '../Loader';
import { getTags } from '../platform';

/** CSS loader plugin. */

export class CSS implements LoaderPlugin {

	instantiate(record: Record) {
		if(!getTags) return;

		let element: HTMLStyleElement | HTMLLinkElement;
		const head = getTags('head')[0];

		if(record.sourceCode) {
			// Inject as a style element if transpiled.
			// Relative URLs must be fixed by the transpiler.

			const style = document.createElement('style');
			style.innerHTML = record.sourceCode;
			element = style;
		} else {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = record.resolvedKey;
			element = link;
		}

		element.type = 'text/css';

		head.appendChild(element);
	}

}
