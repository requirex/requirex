import { PluginStack } from './Plugin';
import { ModuleObject } from './ModuleObject';
import { Package } from './packages/Package';
import { Record } from './Record';
import { LoaderPlugin } from './Plugin';

export function addPlugin(plugin: LoaderPlugin, stack: PluginStack) {
	let frame: PluginStack | undefined = stack;

	while(frame) {
		if(frame.plugin == plugin) return stack;
		frame = frame.next;
	}

	return { plugin, next: stack };
}

export interface CustomPlugin {
	normalize?: (arg: string) => string;
	load?: any;
}

/** Metadata related to an entire recursive import process. */

export interface Status {

	/** Table of recursive dependencies seen, to break circular chains. */
	importTbl: { [resolvedKey: string]: Promise<Record | undefined> | undefined };

	/** Current document if in a browser. Changing this allows for example
	  * importing CSS files into popup windows. */
	document?: Document;

	/** True if code is imported and analysed for bundling purposes.
	  * Means code should not be fetched dynamically at run-time based on
	  * computed results. */
	isBuild?: boolean;

	/** True if imports are resolved with the goal of fetching them.
	  * Means testing for existence of files may waste time and should be
	  * avoided when fetching is likely to work. */
	isImport?: boolean;

	/** True if code will be executed after importing. */
	isInstantiation?: boolean;

}

/** Metadata related to a single import or require statement.
  * Multiple imports referring to the same file are different importations
  * sharing a single record. */

export interface Importation {

	baseKey?: string;

	/** Name used in the original import statement. */
	importKey: string;

	/** Name of a referenced but not yet fetched package. */
	missingPackageName?: string;

	/** AMD loader plugin. */
	customPlugin?: CustomPlugin;

	/** Argument for AMD loader plugin. */
	customArg?: string;

	/** Source code fetched during a file existence check,
	  * stored to avoid another request later. */
	sourceCode?: string;

	/** Current file extension. */
	extension?: string;
	/** Possible file extensions to try if current extension is unrecognized. */
	extensionList: string[];

	module?: ModuleObject;
	package: Package;
	pluginStack: PluginStack;
	resolveStack: PluginStack;
	record?: Record;
	parent?: Record;
	result?: Promise<Record | undefined>;
	status: Status;

}
