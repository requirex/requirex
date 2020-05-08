const testList: Test[] = [];

function log(msg: string) {
	process.stdout.write(msg + '\n');
}

function logFail(
	actual: boolean | number | string | null | undefined,
	expected: boolean | number | string | null | undefined,
	operator: string,
	msg?: string
) {
	const hook = 'prepareStackTrace';
	const prepareStackTrace = Error[hook];
	Error[hook] = (err, stack) => stack;

	const stack = new Error().stack as any as NodeJS.CallSite[];
	const libPath = stack[0].getFileName() || '';
	let at = '';

	for(let site of stack) {
		at = site.getFileName() || libPath;
		if(at == libPath) continue;

		at = (
			(site.getFunctionName() || 'anonymous') +
			' (' + at + ':' + site.getLineNumber() + ')'
		);

		break;
	}

	Error[hook] = prepareStackTrace;

	log([
		'not ok ' + msg,
		'  ---',
		'    operator: ' + operator,
		'    expected: ' + JSON.stringify(expected),
		'    actual:   ' + JSON.stringify(actual),
		'    at: ' + at,
		'  ...'
	].join('\n'));
}

export class Test {

	equal(
		actual: boolean | number | string | null | undefined,
		expected: boolean | number | string | null | undefined,
		msg?: string
	) {
		++this.tests;

		const operator = 'equal';
		msg = msg || 'should be ' + operator;

		if(actual === expected) {
			log('ok ' + msg);

			++this.passed;
		} else {
			logFail(actual, expected, operator, msg);

			++this.failed;
		}
	}

	plan(tests: number) {
		this.tests = tests;
	}

	end() {}

	tests = 0;
	passed = 0;
	failed = 0;

}

function report() {
	let tests = 0, passed = 0, failed = 0;

	for(let instance of testList) {
		tests += instance.tests;
		passed += instance.passed;
		failed += instance.failed;
	}

	log('\n1..' + tests);
	log('# tests ' + tests);
	if(passed) log('# pass  ' + passed);
	if(failed) log('# fail  ' + failed);

	if(!failed) log('\n# ok');
}

export function test(name: string, handler: (t: Test) => void | Promise<void>) {
	if(!testList.length) {
		console.log('TAP version 13');
		process.on('exit', report);
	}

	const instance = new Test();
	testList.push(instance);

	// TODO: If test is async, print results only after finish to preserve their ordering.

	console.log('# ' + name);
	const result = handler(instance);

	if(typeof result == 'object' && result.then) {
		result.then(() => {});
	}
}
