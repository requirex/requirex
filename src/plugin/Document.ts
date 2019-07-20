import { URL } from '../URL';
import { Record, DepRef } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { origin, getTags, globalEnv, assign, assignReversible } from '../platform';

/** Document element loader plugin. */

export class Document implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolveSync(key: string, baseKey?: string) {
		return baseKey || origin;
	}

	fetchRecord() {
		return new Promise<void>((resolve: () => void, reject: (err: any) => void) => {
			let resolved = false;
			// Disregard initial "interactive" state to work around browser issues.
			let almostReady = 'complete';

			function check() {
				const ready = document.readyState;
			
				if(!resolved && (!ready || ready == 'complete' || ready == almostReady)) {
					resolve();
					resolved = true;
				}
			
				return resolved;
			}

			if(check()) return;

			if(document.addEventListener) {
				almostReady = 'interactive';
				document.addEventListener('DOMContentLoaded', check);
				window.addEventListener('load', check);
			} else if((document as any).attachEvent) {
				// Support ancient IE.
				(document as any).attachEvent('onreadystatechange', check);
			} else {
				reject(new Error('Unsupported browser'));
			}
		});
	}

	discover(record: Record) {
		const key = origin + window.location.pathname + window.location.search;
		let inlineCount = 0;

		for(let element of [].slice.call(getTags && getTags('script')) as HTMLScriptElement[]) {
			const type = element.type;
			if(type && type.substr(0, 5) == 'x-req') {
				element.setAttribute('type', '-' + type);

				if(element.src) {
					// External script.
					record.addDep(URL.resolve(key, element.src));
				} else {
					// Inline script.
					const code = element.text;

					const inline: DepRef = {
						format: 'js',
						sourceKey: key,
						// Remove leading whitespace to ensure a possible
						// strict pragma remains on the first line.
						sourceCode: code.replace(/^\s+/, ''),
						// Inject transpiled inline scripts in order without
						// a wrapper function to ensure they get evaluated
						// in the correct environment.
						eval: (record: Record) => {
							const oldVars = assignReversible(globalEnv, record.argTbl);

							const script = document.createElement('script');
							const content = document.createTextNode(record.wrap(true, true));

							script.appendChild(content);
							element.parentNode!.replaceChild(script, element);

							assign(globalEnv, oldVars);
						}
					};

					++inlineCount;
					record.addDep(URL.resolve(key, '#' + inlineCount + '.jsx'), inline);
				}
			}
		}
	}

	instantiate(record: Record) {
		// Execute scripts in order of appearance.
		for(let key of record.depList) {
			const dep = record.depTbl[key];
			if(dep.record) this.loader.instantiate(dep.record);
		}
	}

}
