import { Record } from '../Record';
import { LoaderPlugin, pluginFactory } from '../Plugin';

class JsonPlugin implements LoaderPlugin {

	instantiate(record: Record) {
		return record.compiled || (record.sourceCode && JSON.parse(record.sourceCode));
	}

	wrap(record: Record) {
		return record.sourceCode || 'null';
	}

	id?: string;

}

export const Json = pluginFactory('json', JsonPlugin);
