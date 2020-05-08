import { URL } from '../platform/URL';
import { Record } from '../Record';
import { LoaderPlugin, pluginFactory, PluginSpec } from '../Plugin';
import { Loader } from '../Loader';

const enum ParserState {
	OUT,
	IN_ELEMENT,
	IN_ATTRIBUTE,
	IN_COMMENT,
	IN_SCRIPT_CONTENT
}

class HTMLPlugin implements LoaderPlugin {

	constructor(private loader: Loader, config?: { js?: PluginSpec }) {
		if(config && config.js) {
			this.js = loader.initPlugin(config.js);
		}
	}

	analyze(record: Record) {
		let code = '';
		const html = record.sourceCode || '';
		const re = new RegExp(
			(
				'<!--|' +
				'-->|' +
				'/>|' +
				'[">]|' +
				'</?((script|style)([ \t\n]*(/?>)?))?|' +
				'type[ \t\n]*=[ \t\n]*"x-req[^-]*-([^"]*)"|' +
				'src[ \t\n]*=[ \t\n]*"([^"]*)"'
			),
			'gi'
		);
		let match: RegExpExecArray | null;
		let state: ParserState = ParserState.OUT;
		let syntaxDepth = 0;
		let inScript = false;
		let mime = '';
		let src = '';
		let nameLen = 0;
		let scriptStart = 0;

		while((match = re.exec(html))) {
			let token = match[0];

			switch(state) {

				case ParserState.OUT:
					if(token == '<!--') {
						state = ParserState.IN_COMMENT;
						++syntaxDepth;
						break;
					} else if(token.charAt(0) == '<') {
						state = ParserState.IN_ELEMENT;
						++syntaxDepth;

						if(match[2]) {
							nameLen = match[2].length;
							inScript = token.charAt(1) != '/' && !!match[3];
							mime = '';
							src = '';
							token = match[4];
						} else {
							inScript = false;
							break;
						}
					} else {
						break;
					}

				// Fallthru
				case ParserState.IN_ELEMENT:
					if(token == '"') {
						state = ParserState.IN_ATTRIBUTE;
					} else if(token == '/>' || token == '>') {
						state = ParserState.OUT;
						--syntaxDepth;

						if(inScript) {
							if(token == '>') {
								state = ParserState.IN_SCRIPT_CONTENT;
								scriptStart = re.lastIndex;
							}

							if(mime && src) {
								// Ensure import path is either explicitly relative or an absolute URL.
								if(!/^(\.?\.?\/|[a-z]+:)/.test(src)) src = './' + src;

								code += 'require("' + src + '");\n';
							}

							inScript = false;
						}
					} else if(inScript) {
						mime = match[5] || mime;
						src = match[6] || src;
					}
					break;

				case ParserState.IN_ATTRIBUTE:
					if(token == '"') {
						state = ParserState.IN_ELEMENT;
					}
					break;

				case ParserState.IN_COMMENT:
					if(token == '-->') {
						state = ParserState.OUT;
						--syntaxDepth;
					}
					break;

				case ParserState.IN_SCRIPT_CONTENT:
					if(match[2] && match[2].length == nameLen && token.charAt(1) == '/' && match[4]) {
						if(mime && !src) {
							code += html.substr(scriptStart, re.lastIndex - match[0].length - scriptStart);
						}
						state = ParserState.OUT;
					}
					break;

			}
		}

		// console.log(state, syntaxDepth, 'SHOULD BE', 0, 0);
		// console.log(code);

		// const importation = this.loader.newImportation('./#.js', record.resolvedKey);
		// importation.sourceCode = code;

		// record.addImport('./#.js', importation);

		if(this.js) {
			record.sourceCode = code;
			record.removePlugin(this);
			record.addPlugin(this.js);
		}
	}

	instantiate(record: Record) {
		// console.log(record);
		// return record.compiled || (record.sourceCode && JSON.parse(record.sourceCode));
	}

	/* wrap(record: Record) {
		return record.sourceCode || 'null';
	} */

	extensions: { [name: string]: LoaderPlugin | undefined } = {
		html: this,
		htm: this,
	};

	id?: string;
	js?: LoaderPlugin;

}

export const HTML = pluginFactory('html', HTMLPlugin);
