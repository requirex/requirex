import { features, globalEnv, getTags, keys, assign } from './platform';
import { Loader, LoaderConfig, LoaderPlugin } from './Loader';

// Import all plugins to include in development bundle.

import { JS } from './plugin/JS';
import { AMD } from './plugin/AMD';
import { CJS } from './plugin/CJS';
import { Register } from './plugin/Register';
import { TS } from './plugin/TS';
import { PostCSS } from './plugin/PostCSS';
import { CSS } from './plugin/CSS';
import { TXT } from './plugin/TXT';
import { Json } from './plugin/Json';
import { Node } from './plugin/NodeBuiltin';
import { NodeResolve } from './plugin/NodeResolve';
import { Document } from './plugin/Document';
import { FetchCache } from './plugin/Cache';

import { URL } from './URL';
import { fetch, FetchResponse } from './fetch';

export { LoaderConfig, LoaderPlugin };
export { features, URL, fetch, FetchResponse, Loader };
export { globalEnv, keys, assign };

const internals = {
	features, URL, fetch, FetchResponse, Loader,
	globalEnv, keys, assign
};

features.fetch = fetch;

/** This module, importable from code running inside. */
const requirex = internals as typeof internals & { System: Loader };
const globalSystem = globalEnv.System;

export const System = new Loader({
	cdn: 'https://cdn.jsdelivr.net/npm/',
	globals: {
		process: features.isNode ? globalEnv.process : {
			argv: [ '/bin/node' ],
			cwd: () => System.cwd,
			env: { 'NODE_ENV': 'production' }
		}
	},
	mainFields: features.isNode ? [ 'main', 'module' ] : [ 'browser', 'main', 'module' ],
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
		css: PostCSS,
		cssraw: CSS,
		TXT,
		vert: TXT,
		frag: TXT,
		Json,

		Node,
		Document,
		cache: FetchCache
	},
	registry: {
		'@empty': {},
		// Prevent TypeScript compiler from importing some optional modules.
		'source-map-support': {},
		'@microsoft/typescript-etw': {},
		requirex
	},
	dependencies: {
		'typescript': '^3',
		'requirex-postcss-bundle': '~0.0.2'
	}
});

requirex.System = System;

if(!globalSystem) globalEnv.System = System;

if(getTags) {
	System.import('document!');
}
