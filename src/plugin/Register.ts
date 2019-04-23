import { Record } from '../Record';
import { globalEnv, globalEval } from '../platform';
import { Loader, LoaderConfig, SystemDeclaration } from '../LoaderBase';

export class Register extends Loader {

	// constructor(config?: LoaderConfig) {}

	discover(record: Record) {
		const exports = {};

		record.moduleInternal = {
			exports,
			id: record.resolvedKey
		};

		this.latestRecord = record;

		try {
			const wrapped = globalEval(globalEnv, record.sourceCode, record.globalTbl, {
				'System': this
			});

			// Call imported module.
			wrapped();
		} catch(err) {
			record.loadError = err;
		}

		this.latestRecord = void 0;
	}

	instantiate(record: Record) {
		function addExport(name: string, value: any) {
			record.moduleInternal.exports[name] = value;
		}

		const spec: SystemDeclaration = record.factory.call(globalEnv, addExport, record.moduleInternal);

		// TODO: Handle spec.exports!

		for(let num = 0; num < record.depNumList.length; ++num) {
			const ref = record.depTbl[record.depList[record.depNumList[num] - 3]];
			const dep = ref.module ? ref.module.exports : this.instantiate(ref.record!);

			if(spec.setters && spec.setters[num]) {
				spec.setters[num].call(null, dep);
			}
		}

		if(spec.execute) spec.execute();

		return(record.moduleInternal.exports);
	}

}
