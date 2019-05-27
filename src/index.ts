import { globalEnv, getTags } from './platform';
import { Loader, LoaderConfig } from './Loader';

import { JS } from './plugin/JS';
import { AMD } from './plugin/AMD';
import { CJS } from './plugin/CJS';
import { Register } from './plugin/Register';
import { TS } from './plugin/TS';
import { CSS } from './plugin/CSS';
import { TXT } from './plugin/TXT';
import { Json } from './plugin/Json';
import { Node } from './plugin/NodeBuiltin';
import { NodeResolve } from './plugin/NodeResolve';
import { Document } from './plugin/Document';

import { URL } from './URL';
import { fetch, FetchResponse } from './fetch';

export { LoaderConfig };
export { URL, fetch, FetchResponse, Loader };

const internals = {
	URL, fetch, FetchResponse, Loader
};

/** This module, importable from code running inside. */
const requirex = internals as typeof internals & { System: Loader };
const globalSystem = globalEnv.System;

export const System = new Loader({
	plugins: {
		resolve: NodeResolve,

		JS,
		AMD,
		CJS,
		system: Register,
		esm: TS,
		TS,
		tsx: TS,
		'd.ts': TS,
		CSS,
		TXT,
		Json,
		Node,
		Document
	},
	registry: {
		'@empty': {},
		// Prevent TypeScript compiler from importing an optional module.
		'source-map-support': {},
		requirex
	}
});

requirex.System = System;

if(!globalSystem) globalEnv.System = System;

if(getTags) {
	System.import('document!');
}
