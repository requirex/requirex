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

export type ModuleType = ModuleCJS | ModuleAMD | ModuleInternal;

// children exports filename id loaded parent paths require
