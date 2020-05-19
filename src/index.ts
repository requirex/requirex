import { URL } from './platform/URL';
import { globalEnv } from './platform/global';
import { features } from './platform/features';
import { fetch, FetchResponse } from './platform/fetch';
import { keys, assign, stripSlash } from './platform/util';
import { WorkerCallee } from './worker/WorkerCallee';
import { RequireX } from './RequireX';
import { Cache } from './stages/Cache';
import { Resolve } from './stages/Resolve';
import { Build } from './stages/Build';
import { NodeBuiltin } from './packages/NodeBuiltin';
import { Custom } from './plugins/Custom';
import { Document } from './plugins/Document';
import { JavaScript } from './formats/JavaScript';
import { TypeScript } from './formats/TypeScript';
import { CommonJS } from './formats/CommonJS';
import { AMD } from './formats/AMD';
import { CSS } from './formats/CSS';
import { Txt } from './formats/Txt';
import { Json } from './formats/Json';
import { Register } from './formats/Register';
import { HTML } from './formats/HTML';

export { features, URL, fetch, FetchResponse };
export { keys, assign, RequireX };

export const System = new RequireX();

/** This module, importable from code running inside. */
const requirex = {
	features, URL, fetch, FetchResponse,
	keys, assign, RequireX,
	System
};

features.fetch = fetch;

if(features.isWorker) {
	// Set up worker router before configuring the loader,
	// to ensure plugins are registered with the router.
	System.internal.setCallee(new WorkerCallee(self as any));
}

const js = JavaScript({
	formats: {
		amd: AMD(),
		cjs: CommonJS(),
		es6: TypeScript(),
		system: Register()
	}
});

const html = HTML()
const txt = Txt();

const location = (typeof self == 'object' && globalEnv.location == self.location && self.location) || void 0;
const baseURL = location && location.href;
let cwd: string | undefined;

if(features.isNode) cwd = stripSlash(process.cwd());

System.config({
	baseURL,
	cwd,
	defaultFormat: js,
	formats: {
		js,
		jsx: js,
		ts: js,
		tsx: js,
		'd.ts': js,
		css: CSS({
			postCSS: true
		}),
		txt,
		frag: txt,
		vert: txt,
		glsl: txt,
		json: Json(),
		htm: html,
		html
	},
	globals: {
		process: features.isNode ? globalEnv.process : {
			argv: ['/bin/node'],
			cwd: () => System.internal.config.cwd,
			env: { 'NODE_ENV': 'production' }
		}
	},
	plugins: [
		NodeBuiltin(),
		Custom(),
		Cache(),
		Resolve({
			cdn: ['https://unpkg.com/'],
			dependencies: {
				'typescript': '^3',
				'requirex-postcss-bundle': '0.3.2'
			},
			mainFields: (features.isNode ? ['main', 'module'] :
				['unpkg', 'browser', 'main', 'module']
			)
		}),
		Build()
	],
	specials: {
		Document: [Document({ href: baseURL, stage: 'auto' })]
	},
	registry: {
		'@empty': {},
		'@undefined': void 0,
		// Prevent TypeScript compiler from importing some optional modules.
		'source-map-support': {},
		'@microsoft/typescript-etw': {},
		requirex
	}
});

if(globalEnv && !(globalEnv as any).System) {
	(globalEnv as any).System = System;
}

if(features.doc) {
	System.import('Document').catch((err) => {
		console.error('Error loading document:');
		if(err && err.message) console.error(err);
	});
}
