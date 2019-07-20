import { Record } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { globalEval } from '../platform';
import { Parser } from '../Parser';

/** Match a hashbang header line used to make JS files executable in *nix systems. */
const reHashBang = /^\ufeff?#![^\r\n]*/;

export class JS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	discover(record: Record) {
		let text = record.sourceCode;

		if(!text) return;

		// Check for a hashbang header line.
		const match = reHashBang.exec(text);

		if(match) {
			// Remove the header.
			text = text.substr(match[0].length);

			// Anything meant to run as a script is probably CommonJS,
			// but keep trying to detect module type anyway.
			record.format = 'cjs';
		}

		const parser = new Parser(text, record).parse();

		record.sourceCode = parser.applyPatches();
	}

	/** Run code with no module format, for example a requirex bundle. */

	instantiate(record: Record) {
		let compiled = record.compiled;

		record.setArgs(record.globalTbl, {
			// Inject loader in evaluated scope.
			System: this.loader
		});

		if(!compiled && !record.eval) {
			try {
				// Compile module into a function under global scope.
				compiled = globalEval(record.wrap(true));
			} catch(err) {
				record.loadError = err;
				throw err;
			}
		}

		// Call imported module.
		if(record.eval) {
			record.eval(record);
		} else {
			compiled.apply(null, record.argValues);
		}
	}

	wrap(record: Record) {
		record.setArgs(record.globalTbl);

		return record.wrap();
	}

}
