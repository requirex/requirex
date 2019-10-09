module.exports = {
	input: '../dist/esm/index.js',
	output: {
		file: '../dist/umd/index.js',
		name: 'requirex',
		format: 'umd'
	},
	onwarn: require('mrepo').onwarn,
	plugins: [ { resolveId: require('mrepo').resolve } ]
};
