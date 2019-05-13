import { Record } from '../Record';
import { globalEnv, globalEval } from '../platform';
import { Loader, LoaderPlugin, SystemDeclaration } from '../Loader';

export const Register = (loader: Loader): LoaderPlugin => {

	// TODO: In browsers a fetch method could simply set globals and
	// inject a script element.

	function discover(record: Record) {
		const exports = {};

		record.moduleInternal = {
			exports,
			id: record.resolvedKey
		};

		record.wrapArgs(record.globalTbl, {
			'System': loader
		});

		loader.latestRecord = record;

		try {
			const compiled = globalEval(record.sourceCode);

			// Call imported module.
			compiled.apply(globalEnv, record.evalArgs);
		} catch(err) {
			record.loadError = err;
		}

		loader.latestRecord = void 0;
	}

	function instantiate(record: Record) {
		function addExport(name: string, value: any) {
			record.moduleInternal.exports[name] = value;
		}

		const spec: SystemDeclaration = record.factory.call(globalEnv, addExport, record.moduleInternal);

		// TODO: Handle spec.exports!

		for(let num = 0; num < record.depNumList.length; ++num) {
			const ref = record.depTbl[record.depList[record.depNumList[num] - 3]];
			const dep = ref.module ? ref.module.exports : loader.instantiate(ref.record!);

			if(spec.setters && spec.setters[num]) {
				spec.setters[num].call(null, dep);
			}
		}

		if(spec.execute) spec.execute();

		return record.moduleInternal.exports;
	}

	return { discover, instantiate };

};
