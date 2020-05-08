import { subClone } from '../platform/util';
import { globalEnv } from '../platform/global';
import { ModuleObject } from '../ModuleObject';
import { Record } from '../Record';
import { LoaderPlugin, pluginFactory } from '../Plugin';
import { RequireX } from '../RequireX';
import { Loader } from '../Loader';

export interface SystemDeclaration {
	setters?: ((val: any) => void)[];
	execute?: () => any;
	exports?: any;
}

export type SystemFactory = (exports?: any, module?: ModuleObject) => SystemDeclaration;

export class RegisterPlugin implements LoaderPlugin {

	constructor(private loader: Loader) { }

	analyze(record: Record) {
		const loader = this.loader;
		const exports = {};

		record.moduleInternal = {
			exports,
			id: record.resolvedKey
		};

		const System: RequireX & {
			register?: (deps: string[], factory: SystemFactory) => void
		} = subClone(loader.external);

		System.register = (deps, factory) => {
			let record = this.latestRecord;

			if(record) {
				for(let dep of deps) {
					record.importNumList.push(record.addImport(dep) + 3);
				}

				record.factory = factory;
			}
		};

		record.setArgs(record.globals, { System });

		this.latestRecord = record;

		try {
			const compiled = record.compiled || record.wrap();

			// Call imported module.
			compiled.apply(globalEnv, record.argValues);
		} catch(err) {
			// record.loadError = err;
		}

		this.latestRecord = void 0;
	}

	instantiate(record: Record) {
		function addExport(name: string, value: any) {
			record.moduleInternal!.exports[name] = value;
		}

		const spec: SystemDeclaration = record.factory!.call(globalEnv, addExport, record.moduleInternal);

		// TODO: Handle spec.exports!

		for(let num = 0; num < record.importNumList.length; ++num) {
			const ref = record.importTbl[record.importList[record.importNumList[num] - 3]]!;
			const dep = ref.module ? ref.module.exports : this.loader.instantiate(ref.record!);

			if(spec.setters && spec.setters[num]) {
				spec.setters[num].call(null, dep);
			}
		}

		if(spec.execute) spec.execute();

		return record.moduleInternal!.exports;
	}

	/* wrap(record: Record) {
		return record.withWrapper();
	} */

	latestRecord?: Record;

	id?: string;

}

export const Register = pluginFactory('sys', RegisterPlugin);
