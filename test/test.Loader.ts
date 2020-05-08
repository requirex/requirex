import { test } from './index';
import { RequireX, System, URL } from '..';

const inputs: string[][] = [];

const srcProto = 'http://';
const srcDomain = 'example.invalid';
const dstDomain = 'other.invalid';

const str = JSON.stringify;

for(let [ srcPath, srcName ] of [
	[ '', '' ],
	[ '/', '' ],
	[ '/', 'a.js' ],
	[ '/dir/', 'a.js' ]
]) {
	inputs.push([
		'b.js',
		srcProto + srcDomain + srcPath + srcName,
		srcProto + srcDomain + (srcPath || '/') + 'b.js'
	]);

	inputs.push([
		'/b.js',
		srcProto + srcDomain + srcPath + srcName,
		srcProto + srcDomain + '/b.js'
	]);

	inputs.push([
		'https:b.js',
		srcProto + srcDomain + srcPath + srcName,
		'https://' + srcDomain + (srcPath || '/') + 'b.js'
	]);

	inputs.push([
		'//' + dstDomain + '/b.js',
		srcProto + srcDomain + srcPath + srcName,
		srcProto + dstDomain + '/b.js'
	]);
}

test('Loader.import caller path detection for Node.js', async (t) => {
	const loader = new RequireX();
	const key = URL.fromLocal(__filename);

	loader.import('./empty.js');
	t.equal(loader.internal.config.libraryBaseKey, key, 'config.libraryBaseKey == ' + str(key));
});

test('Loader.resolve without plugins', async (t) => {
	const loader = new RequireX().internal;

	for(let input of inputs) {
		t.equal(
			await loader.resolve(input[0], input[1]),
			input[2],
			'Loader.resolve(' + str(input[0]) + ', ' + str(input[1]) + ')'
		);
	}
});
