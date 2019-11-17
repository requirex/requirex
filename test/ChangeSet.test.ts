import * as test from 'blue-tape';
import { replaceCode } from '../dist/cjs/ChangeSet';

test('Code transformation preserving source maps', async (t: test.Test) => {
	const tests = [
		['', '', ''],
		['1', '', ' '],
		['1234567', '', '       '],
		['12345678', '', ' /*...*/'],
		['123456789', '', ' /*1...*/'],

		['*/12345678', '', ' /**\\...*/'],

		['', 'abc', 'abc'],
		['1', 'abc', 'abc'],
		['123', 'abc', 'abc'],
		['1234', 'abc', 'abc '],
		['1234567890', 'abc', 'abc       '],
		['12345678901', 'abc', 'abc /*...*/'],

		['1\n', '', '/* 1 */\n'],
		['1\n2', '', '/* 1 2 */\n '],
		['1\n ', '', '/* 1 */\n '],
		['1\n23', '', '/* 1 23\n*/'],
		['1\n  ', '', '/* 1\n*/'],
		['1\n234', '', '/* 1 23\n4*/'],
		['1\n   ', '', '/* 1\n */'],

		['1\n', 'abc', 'abc /* 1 */\n'],
		['1\n2', 'abc', 'abc /* 1 2 */\n '],
		['1\n ', 'abc', 'abc /* 1 */\n '],
		['1\n23', 'abc', 'abc /* 1 23\n*/'],
		['1\n  ', 'abc', 'abc /* 1\n*/'],
		['1\n234', 'abc', 'abc /* 1 23\n4*/'],
		['1\n   ', 'abc', 'abc /* 1\n */']
	];

	for(let test of tests) {
		t.equal(replaceCode(test[0], test[1]), test[2] || '');
	}
});
