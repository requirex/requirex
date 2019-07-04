declare module 'requirex-postcss-bundle' {

	export interface PostConfig {
		importResolve: (key: string, dir: string) => string | Promise<string>;
		importLoad: (key: string) => string | Promise<string>;
		urlResolve: (key: string, isLocal: boolean) => string;
		minify?: boolean;
	}

	export class PostBuilder {
		config: PostConfig;
		constructor(config: PostConfig);
		build(key: string, baseKey: string): Promise<string>;
		private pluginList;
	}

}
