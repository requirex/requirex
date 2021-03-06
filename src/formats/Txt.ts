import { stringify } from '../platform/util';
import { Record } from '../Record';
import { LoaderPlugin, pluginFactory } from '../Plugin';

class TxtPlugin implements LoaderPlugin {

	instantiate(record: Record) {
		return record.compiled || record.sourceCode || '';
	}

	wrap(record: Record) {
		return stringify(record.sourceCode || record.compiled || '');
	}

	id?: string;

}

export const Txt = pluginFactory('txt', TxtPlugin);
