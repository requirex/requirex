var path = require('path');
var url = require('..').URL;

var resolved = url.fromLocal(path.resolve(process.argv[2]));
var parent = url.resolve(resolved, '.');

System.build(resolved, parent).then(function(code) {
	process.stdout.write(code);
}).catch(function(err) {
	console.trace(err);
});
