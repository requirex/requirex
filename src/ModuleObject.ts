export interface ModuleCJS {
	exports: any;
	filename: string;
	id: string;
	loaded: boolean;
	paths: string[];
	require: NodeRequire;
}

export interface ModuleAMD {
	config: () => any,
	exports: any;
	id: string;
	uri: string;
}

export interface ModuleInternal {
	exports: any;
	id: string;
}

export type ModuleObject = ModuleCJS | ModuleAMD | ModuleInternal;
