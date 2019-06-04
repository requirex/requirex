import { URL } from '../URL';
import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { origin, getTags } from '../platform';

/** Document element loader plugin. */

export class Document implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolveSync(key: string, baseKey?: string) {
		return baseKey || origin;
	}

	fetchRecord(record: Record) {
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
		let num = 0;

		for(let element of [].slice.call(getTags && getTags('script')) as HTMLScriptElement[]) {
			const type = element.type;
			if(type && type.substr(0, 5) == 'x-req') {
				if(element.src) {
					record.addDep(URL.resolve(origin, element.src));
				} else {
					++num;

					record.addDep(URL.resolve(origin, '#' + num + '.js'), {
						format: 'js',
						sourceCode: element.text
					});
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
