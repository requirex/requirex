import { URL } from './platform/URL';
import { Zalgo } from './platform/util';
import { FetchOptions, FetchResponse } from './platform/fetch';
import { features } from './platform/features';
import { Importation } from './Status';
import { Package } from './packages/Package';
import { Record, BuiltSpec } from './Record';
import { Loader } from './Loader';

export type NextResolveSync<T = LoaderPlugin | null> = (
	importation: Importation,
	nextHandlerOrPrevPlugin: T
) => string;

export type NextResolve<T = LoaderPlugin | null> = (
	importation: Importation,
	nextHandlerOrPrevPlugin: T
) => Zalgo<string>;

export type NextFetch<T = LoaderPlugin | null> = (
	resolvedKey: string,
	options: FetchOptions | undefined,
	nextHandlerOrPrevPlugin: T,
	pluginStack?: PluginStack
) => Promise<FetchResponse>;

export type NextFetchRecord<T = LoaderPlugin | null> = (
	record: Record,
	importation: Importation,
	nextHandlerOrPrevPlugin: T
) => Zalgo<Record>;

export type NextAnalyze<T = LoaderPlugin | null> = (
	record: Record,
	importKey: string,
	nextHandlerOrPrevPlugin: T
) => Zalgo<void>;

export type NextTranslate<T = LoaderPlugin | null> = (
	record: Record,
	nextHandlerOrPrevPlugin: T
) => Zalgo<void>;

export type NextInstantiate<T = LoaderPlugin | null> = (
	record: Record,
	nextHandlerOrPrevPlugin: T
) => any;

export type NextBuild<T = LoaderPlugin | null> = (
	record: Record,
	baseKey: string,
	nextHandlerOrPrevPlugin: T
) => string;

export type NextBuilt<T = LoaderPlugin | null> = (
	specList: BuiltSpec[],
	baseKey: string,
	nextHandlerOrPrevPlugin: T,
	pluginStack?: PluginStack
) => Package[];

export type NextWrap<T = LoaderPlugin | null> = (
	record: Record,
	nextHandlerOrPrevPlugin: T
) => string;

export type NextCache<T = LoaderPlugin | null> = (
	record: Record,
	nextHandlerOrPrevPlugin: T
) => Zalgo<void>;

export interface LoaderPlugin {

	resolveSync?: NextResolveSync<NextResolveSync>;
	resolve?: NextResolve<NextResolve>;
	fetch?: NextFetch<NextFetch>;
	fetchRecord?: NextFetchRecord<NextFetchRecord>;
	analyze?: NextAnalyze<NextAnalyze>;
	translate?: NextTranslate<NextTranslate>;
	instantiate?: NextInstantiate<NextInstantiate>;
	build?: NextBuild<NextBuild>;
	built?: NextBuilt<NextBuilt>;
	wrap?: NextWrap<NextWrap>;
	cache?: NextCache<NextCache>;

	id?: string;

}

export interface PluginStack {

	plugin: LoaderPlugin;
	next?: PluginStack;

}

function nextPlugin(
	ref: PluginStack | undefined,
	prevPlugin: LoaderPlugin | null,
	test: (plugin: LoaderPlugin) => any
) {
	if(prevPlugin) {
		while(ref && ref.plugin != prevPlugin) {
			ref = ref.next;
		}

		if(ref) ref = ref.next;
	}

	while(ref && !test(ref.plugin)) {
		ref = ref.next;
	}

	return ref && ref.plugin;
}

/** Call the resolveSync method of the next loader plugin. */

export const nextResolveSync: NextResolveSync = (importation, prevPlugin) => {
	const pluginStack = (importation.parent || importation).pluginStack;
	const plugin = nextPlugin(pluginStack, prevPlugin, (plugin) => plugin.resolveSync)!;

	return plugin.resolveSync!(importation, nextResolveSync);
}

/** Call the resolve method of the next loader plugin. */

export const nextResolve: NextResolve = (importation, prevPlugin) => {
	const plugin = nextPlugin(
		(importation.parent || importation).pluginStack,
		prevPlugin,
		(plugin) => plugin.resolve
	)!;

	return plugin.resolve!(importation, nextResolve);
}

/** Call the fetch method of the next loader plugin. */

export const nextFetch: NextFetch = (resolvedKey, options, prevPlugin, pluginStack) => {
	const plugin = nextPlugin(pluginStack, prevPlugin, (plugin) => plugin.fetch)!;

	return plugin.fetch!(resolvedKey, options, nextFetch);
}

/** Call the fetchRecord method of the next loader plugin. */

export const nextFetchRecord: NextFetchRecord = (record, importation, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.fetchRecord)!;

	return plugin.fetchRecord!(record, importation, nextFetchRecord);
}

export const nextAnalyze: NextAnalyze = (record, importKey, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.analyze)!;

	return plugin.analyze!(record, importKey, nextAnalyze);
}

export const nextTranslate: NextTranslate = (record, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.translate)!;

	return plugin.translate!(record, nextTranslate);
}

export const nextInstantiate: NextInstantiate = (record, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.instantiate)!;

	return plugin.instantiate!(record, nextInstantiate);
}

export const nextBuild: NextBuild = (record, baseKey, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.build)!;

	return plugin.build!(record, baseKey, nextBuild);
}

export const nextBuilt: NextBuilt = (specList, baseKey, prevPlugin, pluginStack) => {
	const plugin = nextPlugin(pluginStack, prevPlugin, (plugin) => plugin.built)!;

	return plugin.built!(specList, baseKey, nextBuilt);
}

export const nextWrap: NextWrap = (record, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.wrap)!;

	return plugin.wrap!(record, nextWrap);
}

export const nextCache: NextCache = (record, prevPlugin) => {
	const plugin = nextPlugin(record.pluginStack, prevPlugin, (plugin) => plugin.cache)!;

	return plugin.cache!(record, nextCache);
}

export class BasePlugin implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolveSync(importation: Importation) {
		return URL.resolve(
			importation.baseKey || this.loader.config.baseURL || '',
			importation.importKey
		);
	}

	resolve(importation: Importation) {
		return this.loader.resolveSync(
			importation.importKey,
			importation.baseKey,
			importation
		);
	}

	fetch(resolvedKey: string, options?: FetchOptions) {
		return features.fetch(resolvedKey, options);
	}

	fetchRecord(record: Record) {
		if(record.sourceCode) return record;

		return this.loader.fetch(record.resolvedKey, {}, record).then((res) => {
			if(res.url) record.resolvedKey = decodeURI(res.url);
			return res.text();
		}).then((text: string) => {
			record.sourceCode = text;
			return record;
		});
	}

	analyze(record: Record) { }

	// This base method gets called directly for records using
	// a custom loader plugin.

	translate(record: Record) {
		if(!record.moduleInternal) record.moduleInternal = {
			exports: {},
			id: record.resolvedKey
		};
	}

	instantiate(record: Record) {
		return record.moduleInternal && record.moduleInternal.exports;
	}

	build(record: Record, baseKey: string) { return ''; }

	built(specList: BuiltSpec[], baseKey: string) { return []; }

	wrap(record: Record) { return ''; }

	cache(record: Record) { }

	id?: string;

}

BasePlugin.prototype.id = 'base';

export interface PluginClass<PluginType extends LoaderPlugin = LoaderPlugin, WorkerType = any, Config = any> {
	new(loader: Loader, config?: Config, worker?: WorkerType): PluginType;
	workerAPI?: ((...args: any[]) => any)[];
}

export interface PluginSpec<PluginType extends LoaderPlugin = LoaderPlugin, WorkerType = any, Config = any> {
	config?: Config;
	Plugin: PluginClass<PluginType, WorkerType, Config>;
	Worker?: { new(loader: Loader, config?: Config): WorkerType };
}

export function pluginFactory<PluginType extends LoaderPlugin, WorkerType, Config>(
	name: string,
	Plugin: PluginClass<PluginType, WorkerType, Config>,
	Worker?: { new(loader: Loader, config?: Config): WorkerType }
): (config?: Config) => PluginSpec<PluginType, WorkerType, Config> {
	Plugin.prototype.id = name;
	return (config?: Config) => ({ config, Plugin, Worker });
}
