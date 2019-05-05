import { Record, ModuleFormat } from '../Record';
import { Loader, LoaderConfig } from '../LoaderBase';

const chunkSize = 128;

/** Table of characters that may surround keyword and identifier names. */
const sep: { [char: string]: boolean } = {};

for(let c of '\t\n\r !"#%&\'()*+,-./:;<=>?@[\\]^`{|}~'.split('')) {
	sep[c] = true;
}

/** Create a regexp for matching string or comment start tokens,
  * curly braces (to track nested blocks) and given keywords.
  *
  * @param keywords Separated by pipe characters, may use regexp syntax. */

function matchTokens(keywords: string) {
	return(new RegExp('["\'`{}]|\/[*/]?|' + keywords, 'g'));
}

/** Match a function call with a non-numeric literal as the first argument. */
const reCallLiteral = /^\s*\(\s*["'`\[{_$A-Za-z]/;

// TODO: What types are valid for the first argument to System.register?
const reRegister = /^\s*\.\s*register\s*\(\s*["'`\[]/;

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

interface TranslateState {

	/** String of code to parse. */
	text: string;

	/** Import record for code to translate. */
	record: Record;

	/** Nesting depth inside curly brace delimited blocks. */
	depth: number;

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
					return(pos);
				}
		}
	}

	return(-1);
}

function parseSyntax(reToken: RegExp, state: TranslateState, handler: any) {
	const err = 'Parse error';
	const text = state.text;
	let depth = state.depth;
	let match: RegExpExecArray | null;
	/** Latest matched token. */
	let token: string;
	let last: number;
	let pos: number;

	// Loop through all interesting tokens in the input string.
	while((match = reToken.exec(text))) {
		token = match[0];
		last = match.index;

		switch(token) {
			case '(': case '{': case '[':

				++depth;
				continue;

			case ')': case '}': case ']':

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
					throw(new Error(err));
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
					throw(new Error(err));
				}

				break;

			case '"': case "'": case '`':

				// Skip a string.
				do {
					// Look for a matching quote.
					last = text.indexOf(token, last + 1);

					// Unterminated strings are errors.
					if(last < 0) {
						throw(new Error(err));
					}

					// Count leading backslashes. An odd number escapes the quote.
					pos = last;
					while(text.charAt(--pos) == '\\') {}

					// Loop until a matching unescaped quote is found.
				} while(!(last - pos & 1))

				break;

			default:

				// Handle matched keywords. Examine what follows them.
				pos = last + token.length;

				// Ensure token is not part of a longer token (surrounding
				// characters are invalid in keyword and identifier names).
				if(
					(sep[text.charAt(last - 1)] || !last) &&
					(sep[text.charAt(pos)] || pos >= text.length)
				) {
					state.depth = depth;
					state.last = last;
					state.pos = pos;
					handler(token, state);
				}

				continue;
		}

		// Jump ahead in input string if a comment, string or regexp was skipped.
		reToken.lastIndex = last + token.length;
	}
}

const formatTbl: { [token: string]: [
	/** Module format suggested by the token. */
	ModuleFormat,
	/** Flag whether detection is certain enough to stop parsing. */
	boolean,
	/** Immediately following content must match to trigger detection. */
	RegExp,
	/** Immediately preceding content must NOT match or format is blacklisted for this file! */
	RegExp | null
] } = {
	// AMD modules contain calls to the define function.
	'define': [ 'amd', true, reCallLiteral, reSet ],
	'System': [ 'system', true, reRegister, reSet ],
	// require suggests CommonJS, but AMD also supports require()
	// so keep trying to detect module type.
	'require': [ 'cjs', false, reCallString, null ],
	// CommonJS modules use exports or module.exports.
	// AMD may use them, but a surrounding define should come first.
	'module': [ 'cjs', true, reModuleExports, null ],
	'exports': [ 'cjs', true, reExports, null ]
};

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
		const chunkBefore = text.substr(last - len, len);

		if(format[3] && format[3]!.test(text.substr(last - len, len))) {
			// Redefining the module syntax makes known usage patterns unlikely.
			state.record.formatBlacklist[format[0]] = true;
			return(false);
		}

		if(format[2].test(chunkAfter)) {
			state.record.format = format[0];
			return(format[1]);
		}
	}

	if((token == 'import' || token == 'export') && !state.depth) {
		// ES modules contain import and export statements
		// at the root level scope.
		state.record.format = 'esm';
		return(true);
	}

	return(false);
}

export class JS extends Loader {

	/** Detect module format (AMD, CommonJS or ES) and report all CommonJS dependencies.
	  * Optimized for speed. */

	discover(record: Record) {
		/** Match string or comment start tokens, curly braces and some keywords. */
		let reToken = matchTokens('module|require|define|System|import|exports?|NODE_ENV');

		/** Finished trying to detect the module format? */
		let formatKnown = false;

		/** CommonJS style require call. Name can be remapped if used inside AMD. */
		let requireToken = 'require';

		// Check for a hashbang header line.
		let match = reHashBang.exec(record.sourceCode);

		if(match) {
			// Remove the header.
			record.sourceCode = record.sourceCode.substr(match[0].length);

			// Anything meant to run as a script is probably CommonJS,
			// but keep trying to detect module type anyway.
			if(!formatKnown) record.format = 'cjs';
		}

		const state: TranslateState = {
			text: record.sourceCode,
			record,
			depth: 0
		};

		parseSyntax(reToken, state, (token: string, state: TranslateState) => {
			if(!formatKnown) {
				formatKnown = guessFormat(token, state);
			}

			if(
				token == requireToken &&
				(state.record.format == 'amd' || state.record.format == 'cjs')
			) {
				const chunkAfter = state.text.substr(state.pos!, chunkSize);

				match = reCallString.exec(chunkAfter);

				if(match && match[1] == match[3]) {
					// Called with a string surrounded in matching quotations.
					record.addDep(match[2]);
				}
			}
		});
	}

}
