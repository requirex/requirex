import { assign, keys, Zalgo } from '../platform/util';
import { features } from '../platform/features';
import { ChangeSet } from '../parser/ChangeSet';
import { parse } from '../parser/parse';
import { Importation } from '../Status';
import { Record } from '../Record';
import { LoaderPlugin, pluginFactory, PluginSpec, NextResolve } from '../Plugin';
import { Loader } from '../Loader';

const enum Keyword {
	// Avoid falsy values when used as a flag.
	ES6_IMPORT = 1,
	ES6_FEATURE,
	JSX
}

/** Match a hashbang header line used to make JS files executable in *nix systems. */
const reHashBang = /^\ufeff?#![^\r\n]*/;

/** Match a function call with a non-numeric literal as the first argument
  * (to detect AMD define calls). */
const reCallLiteral = /^\s*\(\s*["'`\[{_$A-Za-z]/;

// TODO: What types are valid for the first argument to System.register?
const reRegister = /^\s*\.\s*register\s*\(\s*["'`\[]/;

/** Match a string or template literal.
  * NOTE: Unescaped dollar signs are prohibited but line breaks are allowed in
  * template literals. */
const reString = (
	'"([^\n\\\\"]|\\\\[^\r\n])*"|' +
	"'([^\n\\\\']|\\\\[^\r\n])*'|" +
	'`([^\$\\\\`]|\\\\.)*`'
);

/** Match a function call with a string argument. */
const reCallString = new RegExp('^\\s*\\(\\s*(' + reString + ')\\s*\\)');

/** Match using module['exports'] or module.exports in a function call,
  * assignment to it, or access of its members using dot or array notation. */
const reModuleExports = /^\s*(\[\s*["'`]exports["'`]\s*\]|\.\s*exports)\s*(\[\s*["'`]|[.=),])/;

/** Match access to members of exports using dot or array notation. */
const reIsMemberAccess = /^\s*(\[\s*["'`]|\.)/;

type VariableSpec = [LoaderPlugin | undefined, RegExp];

interface JavaScriptPlugins<Type> {

	[format: string]: Type | undefined;
	amd?: Type;
	cjs?: Type;
	es6?: Type;
	system?: Type;

};

interface JavaScriptConfig {

	formats?: JavaScriptPlugins<PluginSpec>;

}

class JavaScriptPlugin implements LoaderPlugin {

	constructor(private loader: Loader, config?: JavaScriptConfig) {
		const formatConfig = config && config.formats;
		const formats = this.formats;

		for(let key of keys(formatConfig || {})) {
			const plugin = loader.initPlugin(formatConfig![key]!);
			formats[key] = plugin;
		}

		const { amd, system, cjs } = formats;

		this.variableTbl = ({
			// AMD modules contain calls to the define function.
			'define': [amd, reCallLiteral],
			'System': [system, reRegister],
			// CommonJS modules use require and exports or module.exports.
			// AMD may use them, but a surrounding define should come first.
			'require': [cjs, reCallLiteral],
			'module': [cjs, reModuleExports],
			'exports': [cjs, reIsMemberAccess]
		});

		if(!features.isES6) {
			assign(this.keywordTbl, {
				let: Keyword.ES6_FEATURE,
				const: Keyword.ES6_FEATURE,
				'=>': Keyword.ES6_FEATURE,
				'`': Keyword.ES6_FEATURE
			});
		}
	}

	resolve(importation: Importation, next: NextResolve): Zalgo<string> {
		const extensionList = importation.extensionList;

		extensionList.push('js');

		if(importation.parent && importation.parent.hasJSX) {
			extensionList.push('jsx');
		}

		return next(importation, this);
	}

	analyze(record: Record) {
		const { keywordTbl, variableTbl } = this;
		const ignoreTbl: { [token: string]: true | undefined } = {};
		let plugin: LoaderPlugin | undefined;
		let pluginFallback: LoaderPlugin = record.extension == 'js' ? this : this.formats.es6 || this;

		function isTrue(condition: string) {
			return (0, eval)(
				'(function(process){return' + condition + '})'
			)(record.globals.process) ? 1 : 0;
		}

		function onKeyword(token: string, depth: number) {
			const kind = keywordTbl[token];

			if(
				// ES modules contain import and export statements
				// at the root level scope.
				(kind == Keyword.ES6_IMPORT && !depth) ||
				// TODO: Also detect object key value shorthand notation.
				(kind == Keyword.ES6_FEATURE && !features.isES6)
			) {
				record.hasES6 = true;
				ignoreTbl[token] = true;
			}

			if(kind == Keyword.JSX) {
				record.hasJSX = true;
				ignoreTbl[token] = true;
			}
		}

		function onVariable(token: string, chunkAfter: string, isRedefined: boolean) {
			const spec = variableTbl[token];

			if(spec[0] && spec[1].test(chunkAfter)) {
				if(isRedefined) {
					pluginFallback = spec[0];
				} else {
					if(!plugin) plugin = spec[0];
					if(token != 'require') ignoreTbl[token] = true;
				}
			}

			if(!isRedefined && token == 'require') {
				const match = reCallString.exec(chunkAfter);

				if(match) {
					// Strip quotes and report dependency.
					record.addImport(match[1].substr(1, match[1].length - 2));
				}
			}
		}

		// Remove any hashbang header line from the source code.
		// Keep the final line break intact to avoid invalidating source maps.
		const code = (record.sourceCode || '').replace(reHashBang, () => {
			plugin = this.formats.cjs;
			return '';
		});

		const changeSet = new ChangeSet();

		record.hasES6 = false;
		record.hasJSX = false;

		parse(
			code,
			record.resolvedKey,
			{
				changeSet,
				isTrue,
				ignoreTbl,
				keywordTbl,
				onKeyword,
				onVariable,
				variableTbl
			}
		);

		plugin = plugin || pluginFallback;
		if(record.hasES6 || record.hasJSX) plugin = this.formats.es6;

		if(plugin && plugin != this) record.addPlugin(plugin);

		record.update(changeSet.patchCode(code));
	}

	translate(record: Record) {
		if(!record.moduleInternal) record.moduleInternal = {
			exports: {},
			id: record.resolvedKey
		};
	}

	/** Run code with no module format, for example a requirex bundle. */

	instantiate(record: Record) {
		let compiled = record.compiled;

		record.setArgs(record.globals, {
			// Inject loader in evaluated scope.
			System: this.loader.external
		});

		if(!compiled) {
			compiled = record.wrap();
		}

		// Call imported module.
		compiled.apply(null, record.argValues);
	}

	wrap(record: Record) {
		record.setArgs(record.globals);

		const [prologue, epilogue] = record.getWrapper();

		return prologue + (record.sourceCode || '') + epilogue;
	}

	private formats: JavaScriptPlugins<LoaderPlugin> = {};

	private variableTbl: { [token: string]: VariableSpec };

	private keywordTbl: { [token: string]: Keyword } = ({
		import: Keyword.ES6_IMPORT,
		export: Keyword.ES6_IMPORT,
		'>': Keyword.JSX
	});

	id?: string;

}

export const JavaScript = pluginFactory('js', JavaScriptPlugin);
