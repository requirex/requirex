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

const reLabel = new RegExp(':' + reComments + '$');

const reDot = new RegExp('^' + reComments + '\\.');

/** Match an else statement after an if block. */
const reElse = new RegExp(reComments + 'else' + reComments + '(if|\\{)');

interface TranslateState {

	/** String of code to parse. */
	text: string;

	/** Import record for code to translate. */
	record: Record;

	/** Nesting depth inside curly brace delimited blocks. */
	depth: number;
	captureDepth?: number;
	captureStart?: number;
	captureEnd?: number;

	last?: number;
	pos?: number;

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

function parseSyntax(
	reToken: RegExp,
	state: TranslateState,
	handler: (token: string, state: TranslateState, before?: string, after?: string) => void
) {
	const err = 'Parse error';
	const text = state.text;
	let depth = state.depth;
	let match: RegExpExecArray | null;
	/** Latest matched token. */
	let token: string;
	let last: number;
	let pos: number;
	let before: string;
	let after: string;

	// Loop through all interesting tokens in the input string.
	while((match = reToken.exec(text))) {
		token = match[0];
		last = match.index;

		switch(token) {
			case '(': case '{': case '[':

				if(++depth == state.captureDepth) {
					state.captureStart = last;
				}
				continue;

			case ')': case '}': case ']':

				if(depth-- == state.captureDepth) {
					state.captureEnd = last + 1;
					state.captureDepth = -1;
					state.depth = depth;
					state.last = last;
					handler(token, state);
				}
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

				handler(token, state);

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
					state.depth = depth;
					state.last = last;
					state.pos = pos;
					handler(token, state, before, after);
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

/** Check if keyword presence indicates a specific module format.
  *
  * @param token Keyword to analyze.
  * @return True if module format was detected, false otherwise. */

function guessFormat(token: string, state: TranslateState) {
	const format = formatTbl[token];

	if(format && !state.record.formatBlacklist[format[0]]) {
		const text = state.text;
		const last = state.last!;
		const len = Math.min(last, chunkSize);

		// Get some input immediately before and after the token,
		// for quickly testing regexp matches.
		const chunkAfter = text.substr(state.pos!, chunkSize);

		if(format[3] && format[3]!.test(text.substr(last - len, len))) {
			// Redefining the module syntax makes known usage patterns unlikely.
			state.record.formatBlacklist[format[0]] = true;
			return false;
		}

		if(format[2].test(chunkAfter)) {
			state.record.format = format[0];
			return format[1];
		}
	}

	if((token == 'import' || token == 'export') && !state.depth) {
		// ES modules contain import and export statements
		// at the root level scope.
		state.record.format = 'ts';
		return true;
	}

	return false;
}

export class JS implements LoaderPlugin {

	constructor(private loader: Loader) { }

	/** Detect module format (AMD, CommonJS or ES) and report all CommonJS dependencies.
	  * Optimized for speed. */

	discover(record: Record) {
		/** Match string or comment start tokens, curly braces and some keywords. */
		let reToken = matchTokens('module|require|define|System|import|exports?|if|NODE_ENV|let|const|=>');

		/** Finished trying to detect the module format? */
		let formatKnown = false;

		/** CommonJS style require call. Name can be remapped if used inside AMD. */
		let requireToken = 'require';

		let text = record.sourceCode;

		// Check for a hashbang header line.
		let match = reHashBang.exec(text);

		if(match) {
			// Remove the header.
			text = text.substr(match[0].length);

			// Anything meant to run as a script is probably CommonJS,
			// but keep trying to detect module type anyway.
			if(!formatKnown) record.format = 'cjs';
		}

		const state: TranslateState = {
			text,
			record,
			depth: 0,
			captureDepth: -1
		};

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
			DEAD_BLOCK,
			/** Inside a bundle, to be ignored in parsing. */
			BUILT
		}

		let mode = ConditionMode.NONE;
		/** Start offset of "if" statement condition. */
		let conditionStart = 0;
		/** Flag whether any block seen so far in a set of conditionally
		  * compiled if-else statements was not eliminated. */
		let wasAlive = false;

		const patches: [number, number, number, number][] = [];

		parseSyntax(reToken, state, (token: string, state: TranslateState, before?: string, after?: string) => {
			if(token == 'NODE_ENV' && mode == ConditionMode.CONDITION) {
				mode = ConditionMode.STATIC_CONDITION;
			}

			// Detect "if" statements not nested inside conditionally compiled blocks
			// (which is still unsupported, would need a state stack here).

			if(before == '.') return;

			if(token == 'System' && state.captureDepth! < 0 && reBuilt.test(text.substr(state.pos!, chunkSize))) {
				// Avoid re-processing bundled code.
				mode = ConditionMode.BUILT;
				state.captureDepth = state.depth + 1;
			}

			if(token == 'if' && state.captureDepth! < 0) {
				conditionStart = state.last!;

				if(mode == ConditionMode.NONE) {
					wasAlive = false;
				}

				mode = ConditionMode.CONDITION;
				// Capture the "if" statement conditions.
				state.captureDepth = state.depth + 1;
			}

			// Handle end of captured "if" statement conditions (closing paren
			// tokens are only emitted when nesting depth matches captureDepth,
			// only set when parsing "if" statements).

			if(token == ')') {
				// Ensure a NODE_ENV constant was seen and a block delimited
				// by curly braces follows (parsing individual expressions
				// is still unsupported).

				if(
					mode == ConditionMode.STATIC_CONDITION &&
					reBlock.test(text.substr(state.captureEnd!, chunkSize))
				) {
					if(wasAlive) {
						// If a previous block among the if-else statements
						// was not eliminated, all following "else" blocks
						// must be.

						mode = ConditionMode.DEAD_BLOCK;
						state.captureDepth = state.depth + 1;
					} else {
						// Stop conditional compilation if an error occurs.
						mode = ConditionMode.NONE;

						/** Condition extracted from latest "if" statement. */
						const condition = text.substr(
							state.captureStart!,
							state.captureEnd! - state.captureStart!
						);

						// Ensure the condition clearly has no side effects
						// and try to evaluate it.

						if(!reCallAssign.test(condition)) try {
							// Prepare to handle an alive or dead block based
							// on the conditions.
							mode = (0, eval)(
								'(function(process){return' + condition + '})'
							)(record.globalTbl.process) ? ConditionMode.ALIVE_BLOCK : ConditionMode.DEAD_BLOCK;

							// If no errors were thrown, capture the following
							// curly brace delimited block.
							state.captureDepth = state.depth + 1;
						} catch(err) { }
					}
				} else {
					mode = ConditionMode.NONE;
				}
			}

			// Handle a just captured, conditionally compiled curly brace
			// delimited block.

			if(token == '}' && mode != ConditionMode.NONE) {
				const alive = mode == ConditionMode.ALIVE_BLOCK;
				wasAlive = wasAlive || alive;

				let patchStart = state.captureStart! + 1;
				const patchEnd = state.captureEnd! - 1;

				if(alive) {
					// Set mode for next block in case of an "else" statement.
					mode = ConditionMode.DEAD_BLOCK;
				} else {
					// Prepare for an "else" statement.
					if(!wasAlive) mode = ConditionMode.ALIVE_BLOCK;
					// Set start = end to clear block contents.
					patchStart = patchEnd;
				}

				// Patch the code to match conditions.
				patches.push([
					// Beginning of latest "if" or "else" statement.
					conditionStart,
					// Replace with if(0) or if(1).
					+alive,
					patchStart,
					patchEnd
				]);

				/** Match a following "else" statement followed by an "if" or
				  * curly brace delimited block. */
				const elseMatch = text.substr(state.captureEnd!, chunkSize).match(reElse);

				if(elseMatch) {
					conditionStart = state.captureEnd! + elseMatch[0].length - 1;
					state.captureDepth = state.depth + 1;
				} else {
					mode = ConditionMode.NONE;
				}
			}

			// Disregard eliminated code in module format and dependency detection.
			if(mode == ConditionMode.DEAD_BLOCK || mode == ConditionMode.BUILT) return;

			if(
				!features.isES6 &&
				(token == '`' || token == 'let' || token == 'const' || token == '=>')
			) {
				state.record.format = 'ts';
				formatKnown = true;
			}

			if(!formatKnown) {
				formatKnown = guessFormat(token, state);
			}

			if(
				token == requireToken &&
				(state.record.format == 'amd' || state.record.format == 'cjs')
			) {
				const chunkAfter = text.substr(state.pos!, chunkSize);

				match = reCallString.exec(chunkAfter);

				if(match && match[1] == match[3]) {
					// Called with a string surrounded in matching quotations.
					record.addDep(match[2]);
				}
			}
		});

		// Apply patches from conditional compilation.

		if(patches.length) {
			let result = '';
			let pos = 0;

			for(let patch of patches) {
				result += (
					text.substr(pos, patch[0] - pos) +
					'if(' + patch[1] + ') {' +
					text.substr(patch[2], patch[3] - patch[2]) +
					'}'
				);

				pos = patch[3] + 1;
			}

			text = result + text.substr(pos);
		}

		record.sourceCode = text;
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
				compiled = globalEval(record.wrap());
			} catch(err) {
				record.loadError = err;
				throw err;
			}
		}

		// Call imported module.
		compiled.apply(null, record.argValues);
	}

}
