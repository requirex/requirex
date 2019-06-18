import { Record } from '../Record';
import { globalEnv, globalEval } from '../platform';
import { Loader, LoaderPlugin, SystemDeclaration } from '../Loader';

export class Register implements LoaderPlugin {

	constructor(private loader: Loader) { }

	discover(record: Record) {
		const loader = this.loader;
		const exports = {};

		record.moduleInternal = {
			exports,
			id: record.resolvedKey
		};

		record.setArgs(record.globalTbl, {
			'System': loader
		});

		loader.latestRecord = record;

		try {
			const compiled = globalEval(record.wrap());

			// Call imported module.
			compiled.apply(globalEnv, record.argValues);
		} catch(err) {
			record.loadError = err;
		}

		loader.latestRecord = void 0;
	}

	instantiate(record: Record) {
		function addExport(name: string, value: any) {
			record.moduleInternal.exports[name] = value;
		}

		const spec: SystemDeclaration = record.factory.call(globalEnv, addExport, record.moduleInternal);

		// TODO: Handle spec.exports!

		for(let num = 0; num < record.depNumList.length; ++num) {
			const ref = record.depTbl[record.depList[record.depNumList[num] - 3]];
			const dep = ref.module ? ref.module.exports : this.loader.instantiate(ref.record!);

			if(spec.setters && spec.setters[num]) {
				spec.setters[num].call(null, dep);
			}
		}

		if(spec.execute) spec.execute();

		return record.moduleInternal.exports;
	}

	wrap(record: Record) {
		return record.wrap();
	}

}
