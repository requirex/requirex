import * as test from 'blue-tape';
import { System } from '../src';
import { getRepoPaths } from '../src/plugin/NodeResolve';

// Super Simple Sanity tests
test(async (t: any) => {
    const loader = System;

    const out = getRepoPaths(loader, 'libzim');
    console.log(out);
    t.ok(true);
});