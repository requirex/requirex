import { BuiltSpec } from './Record';
import { Loader, LoaderConfig } from './Loader';

export class RequireX {

	constructor(config?: LoaderConfig) {
		this.internal = new Loader(this);
		if(config) this.config(config);
	}

	config(config: LoaderConfig) {
		this.internal.setConfig(config);
	}

	import(importKey: string) {
		return this.internal.import(importKey);
	}

	build(importKey: string, baseKey?: string) {
		return this.internal.build(importKey, baseKey);
	}

	built(version: number, main: number, specList: BuiltSpec[]) {
		if(version != 1) throw (new Error('Unsupported bundle format'));

		return this.internal.built(main, specList);
	}

	internal: Loader;

}
