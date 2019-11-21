import * as test from 'blue-tape';
import { reString } from '../dist/cjs/Parser';

test('String detection', async (t: test.Test) => {
	const re = new RegExp(reString);

	const matched = [
		"''",
		'""',
		'"\\ "',
		'"\\\\"',
		'``',
		'`\n`',
		'`\\$`'
	];

	const unmatched = [
		'',
		"'",
		'"',
		'`',
		'"\\"',
		'"\\\\\\"',
		'"\n"',
		'"\\\n"',
		'\'"',
		'`$`',
		'`\\\\$`'
	];

	for(let test of matched) {
		t.equal(re.test(test), true);
	}

	for(let test of unmatched) {
		t.equal(re.test(test), false);
	}
});
