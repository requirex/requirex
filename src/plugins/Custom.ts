import { Zalgo } from '../platform/util';
import { Importation } from '../Status';
import { Record } from '../Record';
import { LoaderPlugin, NextResolve, NextFetchRecord, pluginFactory } from '../Plugin';
import { Loader } from '../Loader';

/** Handle AMD-style custom loader plugins. */

class CustomPlugin implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolve(importation: Importation, next: NextResolve): Zalgo<string> {
		let importKey = importation.importKey;
		const split = importKey.indexOf('!');

		// Ignore imports without an exclamation mark indicating a custom plugin.
		if(split < 0) return next(importation, this);

		/** Storage for fully resolved custom plugin address from the loader. */
		const meta: { resolvedKey?: string } = {};

		/** Address of parent script calling the custom plugin.
		  * Plugins use a loader callback passing it an address relative to
		  * the parent script. */
		const baseKey = importation.baseKey || '';

		/** Arguments passed to custom plugin. */
		let customArg = importKey.substr(split + 1);

		// Remove arguments from custom plugin name.
		importKey = importKey.substr(0, split);

		// Load the plugin. Calling full import avoids issues caused by
		// duplicate imports between the parent script and the plugin itself.
		return this.loader.import(importKey, baseKey, meta).then((plugin) => {
			if(plugin.normalize) {
				// If the custom plugin has a normalize hook, use it to
				// transform the plugin arguments.
				customArg = plugin.normalize(
					customArg,
					(key: string) => this.loader.resolveSync(key, baseKey)
				) || '@undefined';
			} else if(customArg.match(/^\.?\.?\//)) {
				customArg = this.loader.resolveSync(customArg, baseKey);
			}

			importation.importKey = importKey;
			importation.customArg = customArg;
			importation.customPlugin = plugin;

			return meta.resolvedKey + '!' + importation!.customArg;
		});
	}

	fetchRecord(record: Record, importation: Importation, next: NextFetchRecord): Zalgo<Record> {
		const customPlugin = importation.customPlugin;

		if(!customPlugin) return next(record, importation, this);

		const meta: { resolvedKey?: string } = {};
		let loadedKey: string;

		return new Promise((resolve, reject) => {
			if(!customPlugin!.load) {
				debugger;
				return reject('Custom plugin has no load method: ' + record.resolvedKey);
			}

			customPlugin.load(
				importation.customArg,
				this.loader.makeRequire(record, importation.baseKey),
				resolve,
				this.loader.config.pluginConfig
			)
		}).then((exports: any) => {
			const module = { exports, id: meta.resolvedKey || record.resolvedKey };

			record.moduleInternal = module;
			record.fetched = Promise.resolve(record);

			return record;
		});
	}

	id?: string;

}

export const Custom = pluginFactory('custom', CustomPlugin);
