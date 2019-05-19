try {
	require.resolve('tap-spec') && require.resolve('ts-node');
} catch(err) {
	process.exit(1);
}
