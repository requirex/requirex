declare module 'requirex-postcss-bundle' {

	export interface PostConfig {
		importResolve: (importKey: string, baseKey: string) => string | Promise<string>;
		importLoad: (key: string) => string | Promise<string>;
		urlResolve: (importKey: string, baseKey: string) => string;
		minify?: boolean;
	}

	export class PostBuilder {
		config: PostConfig;
		constructor(config: PostConfig);
		build(code: string, key: string): Promise<string>;
		private pluginList;
	}

}
