import * as test from 'blue-tape';
import { PackageManager } from '../dist/cjs/PackageManager';
import { getRepoPaths } from '../dist/cjs/PackageManagerNode';

// Super Simple Sanity tests
test(async (t: any) => {
	const manager = new PackageManager();

	const out = getRepoPaths(manager, '', 'libzim');
	console.log(out);
	t.ok(true);
});
