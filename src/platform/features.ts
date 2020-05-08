import { FetchOptions, FetchResponse } from './fetch';

declare const process: any;

export const unsupported = 'Unsupported function ';

// Detect Node.js by checking if the global variable "process"
// is a special V8 object.

const isNode = (
	typeof process == 'object' &&
	({}).toString.call(process) == '[object process]'
);

// Detect ES6 support by trying to run code that uses arrow functions,
// rest parameters, destructuring and template literals.

let isES6: boolean;

try {
	isES6 = (0, eval)('(...a)=>({a}={a:`${a[0]}`})')('x').a == 'x';
} catch(err) {
	isES6 = false;
}

interface WorkerGlobalScope {
	caches: CacheStorage;
	/*
	readonly isSecureContext: boolean;
	readonly location: WorkerLocation;
	onerror: ((this: WorkerGlobalScope, ev: ErrorEvent) => any) | null;
	readonly performance: Performance;
	readonly self: WorkerGlobalScope;
	msWriteProfilerMark(profilerMarkName: string): void;
	addEventListener<K extends keyof WorkerGlobalScopeEventMap>(type: K, listener: (this: WorkerGlobalScope, ev: WorkerGlobalScopeEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
	removeEventListener<K extends keyof WorkerGlobalScopeEventMap>(type: K, listener: (this: WorkerGlobalScope, ev: WorkerGlobalScopeEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
	*/
}

declare var WorkerGlobalScope: {
	prototype: WorkerGlobalScope;
	new(): WorkerGlobalScope;
};

const isWorker = (
	typeof WorkerGlobalScope != 'undefined' &&
	self instanceof WorkerGlobalScope &&
	typeof self.onmessage != 'function'
);

/** Flags for detected platform features.
  * Mutable to allow modification in unit tests. */

export const features = {
	doc: typeof document == 'object' ? document : void 0,
	fetch: (key: string, options?: FetchOptions): Promise<FetchResponse> => {
		throw (new Error(unsupported + 'fetch'));
	},
	isES6,
	isNode,
	isWorker,
	hasWorker: !isWorker && typeof Worker == 'function',
	isWin: (
		isNode &&
		typeof process.platform == 'string' &&
		process.platform.substr(0, 3) == 'win'
	)
};
