import { URL } from '../platform/URL';
import { keys } from '../platform/util';
import { Record } from '../Record';
import { Package } from '../packages/Package';
import { LoaderPlugin, pluginFactory, nextWrap } from '../Plugin';
import { Loader } from '../Loader';

function getAllDeps(
	record: Record,
	depTbl: { [key: string]: Record },
	depList: Record[]
) {
	depTbl[record.resolvedKey] = record;
	depList.push(record);

	for(let name of record.importList) {
		const dep = record.importTbl[name]!.record;

		if(dep && !depTbl[dep.resolvedKey]) getAllDeps(dep, depTbl, depList);
	}

	return depList;
}

export class BuildPlugin implements LoaderPlugin {

	constructor(public loader: Loader) { }

	build(record: Record, baseKey: string) {
		const pkgTbl: { [name: string]: { package: Package, records: Record[] } } = {};

		for(let dep of getAllDeps(record, {}, [])) {
			const pkg = dep.package || this.loader.package;
			let spec = pkgTbl[pkg.name];

			if(!spec) {
				spec = { package: pkg, records: [] };
				pkgTbl[pkg.name] = spec;
			}

			spec.records.push(dep);
		}

		const pkgList = keys(pkgTbl).sort();
		let num = 0;

		for(let name of pkgList) {
			for(let dep of pkgTbl[name].records.sort((a: Record, b: Record) =>
				+(a.resolvedKey < b.resolvedKey) - +(a.resolvedKey > b.resolvedKey)
			)) {
				dep.num = num++;
			}
		}

		const str = JSON.stringify;

		return 'System.built(1,' + record.num + ',[{\n\t' + pkgList.map((name: string) => {
			const spec = pkgTbl[name];
			const pkg = spec.package;
			const fields = ['name: ' + str(pkg.name)];

			if(pkg.version) fields.push('version: ' + str(pkg.version));
			if(pkg.rootKey) {
				fields.push('root: ' + str(
					baseKey ? URL.relative(baseKey, pkg.rootKey) : pkg.rootKey
				));
			}
			if(pkg.main) fields.push('main: ' + str(pkg.main));

			if(keys(pkg.map).length) fields.push('map: ' + str(pkg.map));

			fields.push(
				'files: [\n\t\t[\n' + spec.records.map((record: Record) => {
					// const plugin = this.plugins[record.format!] || this;
					// const code = (plugin.wrap ? plugin : this).wrap!(record);
					// const [prologue, epilogue] = record.getWrapper();
					const code = nextWrap(record, null);

					const deps: string[] = [];

					for(let depName of record.importList.slice(0).sort()) {
						const dep = record.importTbl[depName]!.record;
						deps.push(str(depName) + ': ' + (dep ? dep.num : -1));
					}

					return '\t\t\t/* ' + pkg.name + ': ' + record.num! + ' */\n\t\t\t' + [
						// TODO: registryKey
						str(URL.relative(pkg.rootKey + '/', record.resolvedKey)),
						str(record.getFormat()),
						'{' + deps.join(', ') + '}',
						code
					].join(', ');
				}).join('\n\t\t], [\n') + '\n\t\t]\n\t]'
			);

			return fields.join(',\n\t');
		}).join('\n}, {\n\t') + '\n}]);';
	}

	id?: string;

}

export const Build = pluginFactory('build', BuildPlugin);
