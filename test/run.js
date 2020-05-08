var fs = require('fs');
var ts = require('typescript');
var ext = require.extensions;

function load(key) {
	return fs.readFileSync(key, 'utf8');
}

function compile(module, key, code) {
	// Wrap modules in IIFEs. For some reason this improves V8 code
	// coverage reporting.

	module._compile(
		'(function(){' + code + '\n})();',
		key
	);
}

ext['.js'] = function(module, key) {
	compile(module, key, load(key));
};

ext['.ts'] = function(module, key) {
	compile(module, key,
		ts.transpileModule(load(key), {
			inlineSourceMap: true,
			module: ts.ModuleKind.CommonJS
		}).outputText
	);
};

require(process.argv[2]);
