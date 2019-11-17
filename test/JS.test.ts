import * as test from 'blue-tape';
import { System } from '../dist/cjs';
import { Record } from '../dist/cjs/Record';
import { features } from '../dist/cjs/platform';
import { JS } from '../dist/cjs/plugin/JS';

test('Module format autodetection', async (t: test.Test) => {
	features.isES6 = false;

	const record = new Record(System, '');
	const js = new JS();

	const tests: { [format: string]: string[] } = {
		amd: [
			'define("app", function() {})'
		],
		cjs: [
			'module.exports = {}',
			'require("fs")'
		],
		ts: [
			'export * from "."',
			'let a = 1',
			'foo = () => {}'
		]
	};

	for(let format of Object.keys(tests)) {
		for(let code of tests[format]) {
			record.format = void 0;
			record.sourceCode = code;

			js.discover(record);
			t.equal(record.format, format);
		}
	}

	record.format = void 0;
	record.sourceCode = 'if(process.env.NODE_ENV != "production") { throw new Error(); }';
	record.globalTbl = { process: { env: { NODE_ENV: 'production' } } };

	js.discover(record);
	t.equal(record.sourceCode.replace(/ *\/\*[^*]*\*\/ */g, ''), 'if(0) {}');
});
