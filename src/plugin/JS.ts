import { Record, ModuleFormat } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { features, globalEval } from '../platform';

const chunkSize = 128;

/** Table of characters that may surround keyword and identifier names. */
const sepBefore: { [char: string]: boolean } = {};
const sepAfter: { [char: string]: boolean } = {};

for(let c of '\t\n\r !"#%&\'()*+,-./;<=>?@[\\]^`{|}~'.split('')) {
	sepBefore[c] = true;
	sepAfter[c] = true;
}

sepBefore[':'] = true;

/** Create a regexp for matching string or comment start tokens,
  * curly braces (to track nested blocks) and given keywords.
  *
  * @param keywords Separated by pipe characters, may use regexp syntax. */

function matchTokens(keywords: string) {
	return new RegExp('["\'`{}()]|\/[*/]?|' + keywords, 'g');
}

/** Match a function call with a non-numeric literal as the first argument. */
const reCallLiteral = /^\s*\(\s*["'`\[{_$A-Za-z]/;

// TODO: What types are valid for the first argument to System.register?
const reRegister = /^\s*\.\s*register\s*\(\s*["'`\[]/;

const reBuilt = /^\s*\.\s*built\s*\(\s*1\s*,/;

/** Match a function call with a string argument.
  * Backslashes and dollar signs are prohibited to avoid arbitrary expressions
  * in template literals and escaped string delimiters. */
const reCallString = /^\s*\(\s*(["'`])([^$"'`\\]+)(["'`])\s*\)/;

const reSet = /(function|var|let|const)\s*$/;

/** Match using module['exports'] or module.exports in a function call,
  * assignment to it, or access of its members using dot or array notation. */
const reModuleExports = /^\s*(\[\s*["'`]exports["'`]\s*\]|\.\s*exports)\s*(\[["'`]|[.=),])/;

/** Match access to members of exports using dot or array notation. */
const reExports = /^\s*(\[["'`]|\.)/;

/** Match a non-identifier, non-numeric character or return statement before a regular expression.
  * Example code seen in the wild: function(t){return/[A-Z]+/g.test(t)} */
const reBeforeRegExp = /(^|[!%&(*+,-/:;<=>?\[^{|}~])\s*(return\s*)?$/;

/** Match a hashbang header line used to make JS files executable in *nix systems. */
const reHashBang = /^\ufeff?#![^\r\n]*/;

/** Match any potential function call or assignment, including suspicious comments before parens. */
const reCallAssign = /(\*\/|[^\t\n\r !"#%&'(*+,-./:;<=>?@[\\^`{|~])\s*\(|[^!=]=[^=]|\+\+|--/;

/** Match any number of comments and whitespace. */
const reComments = '\\s*(//[^\n]*\n\\s*|/\\*[^*]*(\\*[^*/][^*]*)*\\*/\\s*)*';

const reBlock = new RegExp('^' + reComments + '\\{');

/** Match an else statement after an if block. */
const reElse = new RegExp('^' + reComments + 'else' + reComments + '(if|\\{)');

const enum ConditionMode {
	/** Not inside any interesting "if" statements. */
	NONE = 0,
	/** Inside the conditions of an "if" statement. */
	CONDITION,
	/** Inside "if" statement conditions, NODE_ENV constant seen. */
	STATIC_CONDITION,
	/** Inside a conditionally compiled block to be left in place. */
	ALIVE_BLOCK,
	/** Inside a conditionally compiled block to eliminate. */
	DEAD_BLOCK
}

class StackItem {

	constructor() {
		this.clear();
	}

	clear() {
		this.mode = ConditionMode.NONE;
		// this.conditionDepth = -1;
		this.conditionStart = 0;
		this.wasAlive = false;

		return this;
	}

	rootToken: string;

	tracking?: boolean;
	start?: number;
	end?: number;

	mode: ConditionMode;
	// conditionDepth: number;
	/** Start offset of "if" statement condition. */
	conditionStart: number;
	/** Flag whether any block seen so far in a set of conditionally
	 * compiled if-else statements was not eliminated. */
	wasAlive: boolean;

	/** Inside a bundle, to be ignored in parsing. */
	isDead: boolean;

}

class StateStack {

	get(depth: number) {
		return this.items[depth] || (this.items[depth] = new StackItem());
	}

	/** Track start and end offsets of parens and braces,
	  * call handler when they end. */

	track(depth: number) {
		this.get(depth + 1).tracking = true;
	}

	items: StackItem[] = [new StackItem()];

}

interface TranslateConfig {

	handler(
		token: string,
		depth: number,
		pos: number,
		last: number,
		before?: string,
		after?: string
	): void;

	reToken: RegExp;

	/** String of code to parse. */
	text: string;

	stack: StateStack;

}

/** Find the end offset of a regular expression literal.
  * Not optimized for speed.
  *
  * @param text String of code to parse.
  * @param pos Index of starting slash character.
  * @return Index of terminating slash or -1 on error. */

function skipRegExp(text: string, pos: number) {
	const len = text.length;
	/** Flag whether current char is inside a character class. */
	let inClass = false;

	while(pos < len) {
		switch(text.charAt(++pos)) {
			case '\\':

				// Backslash removes any special meaning from the next character.
				++pos;
				break;

			case '[':

				inClass = true;
				break;

			case ']':

				inClass = false;
				break;

			case '/':

				// A slash terminates the regexp unless inside a character class.
				if(!inClass) {
					return pos;
				}
		}
	}

	return -1;
}

function parseSyntax(parser: TranslateConfig) {
	const err = 'Parse error';
	const reToken = parser.reToken;
	const stack = parser.stack;
	const text = parser.text;
	/** Nesting depth inside curly brace delimited blocks. */
	let depth = 0;
	let state: StackItem;
	let match: RegExpExecArray | null;
	/** Latest matched token. */
	let token: string;
	let last: number;
	let pos = 0;
	let before: string;
	let after: string;

	// Loop through all interesting tokens in the input string.
	while((match = reToken.exec(text))) {
		token = match[0];
		last = match.index;

		switch(token) {
			case '(': case '{': case '[':

				const parent = stack.items[depth];
				state = stack.get(++depth).clear();
				state.rootToken = token;
				state.isDead = parent.isDead || parent.mode == ConditionMode.DEAD_BLOCK;
				// state.conditionDepth = parent.conditionDepth;

				if(state.tracking) {
					state.start = last;
				}
				continue;

			case ')': case '}': case ']':

				state = stack.get(depth);

				if(state.tracking) {
					state.end = last + 1;
					state.tracking = false;

					const parent = stack.items[depth - 1];
					// Ensure } token terminating a dead block still gets parsed.
					state.isDead = parent.isDead;
					parser.handler(token, depth, pos, last);
				}

				--depth;
				continue;

			case '//':
			case '/*':

				// Skip a comment. Find and jump past the end token.
				token = (token == '//') ? '\n' : '*/';
				last = text.indexOf(token, last + 2);

				if(last < 0) {
					if(token == '\n') return;

					// Unterminated comments are errors.
					throw new Error(err);
				}

				break;

			case '/':

				// Test if the slash begins a regular expression.
				pos = Math.max(last - chunkSize, 0);

				if(!reBeforeRegExp.test(text.substr(pos, last - pos))) {
					continue;
				}

				last = skipRegExp(text, last);

				// Unterminated regular expressions are errors.
				if(last < 0) {
					throw new Error(err);
				}

				break;

			case '`':

				parser.handler(token, depth, pos, last);

			case '"': case "'":

				// Skip a string.
				do {
					// Look for a matching quote.
					last = text.indexOf(token, last + 1);

					// Unterminated strings are errors.
					if(last < 0) {
						throw new Error(err);
					}

					// Count leading backslashes. An odd number escapes the quote.
					pos = last;
					while(text.charAt(--pos) == '\\') { }

					// Loop until a matching unescaped quote is found.
				} while(!(last - pos & 1))

				break;

			default:

				// Handle matched keywords. Examine what follows them.
				pos = last + token.length;

				before = text.charAt(last - 1);
				after = text.charAt(pos);

				// Ensure token is not part of a longer token (surrounding
				// characters should be invalid in keyword and identifier names).
				if(
					(sepBefore[before] || !last) &&
					(sepAfter[after] || pos >= text.length)
				) {
					parser.handler(token, depth, pos, last, before, after);
				}

				continue;
		}

		// Jump ahead in input string if a comment, string or regexp was skipped.
		reToken.lastIndex = last + token.length;
	}
}

const formatTbl: {
	[token: string]: [
		/** Module format suggested by the token. */
		ModuleFormat,
		/** Flag whether detection is certain enough to stop parsing. */
		boolean,
		/** Immediately following content must match to trigger detection. */
		RegExp,
		/** Immediately preceding content must NOT match or format is blacklisted for this file! */
		RegExp | null
	]
} = ({
	// AMD modules contain calls to the define function.
	'define': ['amd', true, reCallLiteral, reSet],
	'System': ['system', true, reRegister, reSet],
	// require suggests CommonJS, but AMD also supports require()
	// so keep trying to detect module type.
	'require': ['cjs', false, reCallString, null],
	// CommonJS modules use exports or module.exports.
	// AMD may use them, but a surrounding define should come first.
	'module': ['cjs', true, reModuleExports, null],
	'exports': ['cjs', true, reExports, null]
});

/** Detect module format (AMD, CommonJS or ES) and report all CommonJS dependencies.
  * Optimized for speed. */

class Parser implements TranslateConfig {

	constructor(
		/** String of code to parse. */
		public text: string,
		/** Import record for code to translate. */
		public record: Record
	) {}

	/** Check if keyword presence indicates a specific module format.
	 *
	 * @param token Keyword to analyze.
	 * @return True if module format was detected, false otherwise. */

	guessFormat(
		token: string,
		depth: number,
		pos: number,
		last: number
	) {
		const format = formatTbl[token];
		const record = this.record;

		if(format && !record.formatBlacklist[format[0]]) {
			const text = this.text;
			const len = Math.min(last, chunkSize);

			// Get some input immediately before and after the token,
			// for quickly testing regexp matches.
			const chunkAfter = text.substr(pos, chunkSize);

			if(format[3] && format[3]!.test(text.substr(last - len, len))) {
				// Redefining the module syntax makes known usage patterns unlikely.
				record.formatBlacklist[format[0]] = true;
				return false;
			}

			if(format[2].test(chunkAfter)) {
				record.format = format[0];
				return format[1];
			}
		}

		if((token == 'import' || token == 'export') && !depth) {
			// ES modules contain import and export statements
			// at the root level scope.
			record.format = 'ts';
			return true;
		}

		return false;
	}

	handler(
		token: string,
		depth: number,
		pos: number,
		last: number,
		before?: string,
		after?: string
	) {
		const text = this.text;
		const stack = this.stack;
		const state = stack.get(depth);

		if(state.isDead) return;

		if(token == 'NODE_ENV') {
			let conditionDepth = depth;

			while(conditionDepth--) {
				const up = stack.items[conditionDepth];

				if(up.rootToken != '(') {
					if(up.mode == ConditionMode.CONDITION) {
						up.mode = ConditionMode.STATIC_CONDITION;
					}

					break;
				}
			}
		}

		if(before == '.') return;

		if(token == 'System' && reBuilt.test(text.substr(pos, chunkSize))) {
			// Avoid re-processing bundled code.
			state.isDead = true;
		}

		if(token == 'if') {
			state.conditionStart = last;

			if(state.mode == ConditionMode.NONE) {
				state.wasAlive = false;
			}

			state.mode = ConditionMode.CONDITION;
			// Track "if" statement conditions.
			stack.track(depth);
		}

		const record = this.record;
		const patches = this.patches;
		const parent = depth && stack.items[depth - 1];

		// Handle end of "if" statement conditions (this token is only
		// emitted when tracking is turned on).

		if(token == ')' && parent) {
			// Ensure a NODE_ENV constant was seen and a block delimited
			// by curly braces follows (parsing individual expressions
			// is still unsupported).

			if(
				parent.mode == ConditionMode.STATIC_CONDITION &&
				reBlock.test(text.substr(state.end!, chunkSize))
			) {
				if(parent.wasAlive) {
					// If a previous block among the if-else statements
					// was not eliminated, all following "else" blocks
					// must be.

					parent.mode = ConditionMode.DEAD_BLOCK;
					patches.push([state.start! + 1, state.end! - 1, '0']);

					stack.track(depth - 1);
				} else {
					// Stop conditional compilation if an error occurs.
					parent.mode = ConditionMode.NONE;

					/** Condition extracted from latest "if" statement. */
					const condition = text.substr(
						state.start!,
						state.end! - state.start!
					);

					// Ensure the condition clearly has no side effects
					// and try to evaluate it.

					if(!reCallAssign.test(condition)) try {
						// Prepare to handle an alive or dead block based
						// on the conditions.
						const alive = +!!((0, eval)(
							'(function(process){return' + condition + '})'
						)(record.globalTbl.process));

						parent.mode = alive ? ConditionMode.ALIVE_BLOCK : ConditionMode.DEAD_BLOCK;
						patches.push([state.start! + 1, state.end! - 1, '' + alive]);

						// If no errors were thrown, find the following
						// curly brace delimited block.
						stack.track(depth - 1);
					} catch(err) { }
				}
			} else {
				parent.mode = ConditionMode.NONE;
			}
		}

		// Handle a just parsed, conditionally compiled curly brace
		// delimited block.

		if(token == '}' && parent && parent.mode != ConditionMode.NONE) {
			const alive = parent.mode == ConditionMode.ALIVE_BLOCK;
			parent.wasAlive = parent.wasAlive || alive;

			if(alive) {
				// Set mode for next block in case of an "else" statement.
				parent.mode = ConditionMode.DEAD_BLOCK;
			} else {
				// Remove dead code.
				patches.push([state.start! + 1, state.end! - 1, '']);
				// Prepare for an "else" statement.
				if(!parent.wasAlive) parent.mode = ConditionMode.ALIVE_BLOCK;
			}

			/** Match a following "else" statement followed by an "if" or
			  * curly brace delimited block. */
			const elseMatch = text.substr(state.end!, chunkSize).match(reElse);

			if(elseMatch) {
				parent.conditionStart = state.end! + elseMatch[0].length - 1;
				stack.track(depth - 1);
			} else {
				parent.mode = ConditionMode.NONE;
			}
		}

		if(
			!features.isES6 &&
			(token == '`' || token == 'let' || token == 'const' || token == '=>')
		) {
			record.format = 'ts';
			this.formatKnown = true;
		}

		if(!this.formatKnown) {
			this.formatKnown = this.guessFormat(token, depth, pos, last);
		}

		if(
			token == this.requireToken &&
			(record.format == 'amd' || record.format == 'cjs')
		) {
			const chunkAfter = text.substr(pos, chunkSize);
			const match = reCallString.exec(chunkAfter);

			if(match && match[1] == match[3]) {
				// Called with a string surrounded in matching quotations.
				record.addDep(match[2]);
			}
		}
	}

	/** Apply patches from conditional compilation. */

	applyPatches() {
		const text = this.text;

		if(!this.patches.length) return text;

		let result = '';
		let pos = 0;

		for(let [start, end, replacement] of this.patches) {
			result += text.substr(pos, start - pos) + replacement;
			pos = end;
		}

		return result + text.substr(pos);
	}

	/** Finished trying to detect the module format? */
	formatKnown: boolean;

	/** Match string or comment start tokens, curly braces and some keywords. */
	reToken = matchTokens('module|require|define|System|import|exports?|if|NODE_ENV|let|const|=>');

	/** CommonJS style require call. Name can be remapped if used inside AMD. */
	requireToken = 'require';

	stack = new StateStack();

	/** Like Array.splice arguments: start, length, replacement. */
	patches: [number, number, string][] = [];

}

export class JS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	discover(record: Record) {
		let text = record.sourceCode;

		// Check for a hashbang header line.
		const match = reHashBang.exec(text);

		if(match) {
			// Remove the header.
			text = text.substr(match[0].length);

			// Anything meant to run as a script is probably CommonJS,
			// but keep trying to detect module type anyway.
			record.format = 'cjs';
		}

		const parser = new Parser(text, record);

		parseSyntax(parser);

		record.sourceCode = parser.applyPatches();
	}

	/** Run code with no module format, for example a requirex bundle. */

	instantiate(record: Record) {
		let compiled = record.compiled;

		record.setArgs(record.globalTbl, {
			// Inject loader in evaluated scope.
			System: this.loader
		});

		if(!compiled) {
			try {
				// Compile module into a function under global scope.
				compiled = globalEval(record.wrap(true));
			} catch(err) {
				record.loadError = err;
				throw err;
			}
		}

		// Call imported module.
		compiled.apply(null, record.argValues);
	}

}
