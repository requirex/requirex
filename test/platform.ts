import * as platform from '../src/platform';
export * from '../src/platform';

export let { isES6 } = platform;

export function mock(spec: any) {
	({ isES6 } = spec);
};
