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

	/** Import record for code to translate. */
	record: Record;

	/** Nesting depth inside curly brace delimited blocks. */
	depth: number;

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
const orig = pos;

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

/** Check if the keyword usage is specific to a module format.
  *
  * @param token Keyword to analyze.
  * @param chunk Some input immediately after the token, for quickly testing
  * regexp matches at the specific location.
  * @return True if module format was detected, false otherwise. */

function guessFormat(token: string, text: string, last: number, pos: number, state: TranslateState) {
	const chunkAfter = text.substr(pos, chunkSize);

	if(token == 'define' && !state.record.formatBlacklist['amd']) {
		const len = Math.min(last, chunkSize);
		const chunkBefore = text.substr(last - len, len);

		if(reSet.test(chunkBefore)) {
			// Redefining the define function makes known AMD usage unlikely.
			state.record.formatBlacklist['amd'] = true;
			return(false);
		}

		if(reCallLiteral.test(chunkAfter)) {
			// AMD modules contain calls to the define function.
			state.record.format = 'amd';
			return(true);
		}
	}

	if(token == 'System' && !state.record.formatBlacklist['system']) {
		const len = Math.min(last, chunkSize);
		const chunkBefore = text.substr(last - len, len);

		if(reSet.test(chunkBefore)) {
			// Redefining the System variable makes known System.register usage unlikely.
			state.record.formatBlacklist['system'] = true;
			return(false);
		}

		if(reRegister.test(chunkAfter)) {
			state.record.format = 'system';
			return(true);
		}
	}

	if(token == 'require' && reCallString.test(chunkAfter)) {
		// CommonJS is likely, but AMD also supports require()
		// so keep trying to detect module type.
		state.record.format = 'cjs';
		return(false);
	}

	if(
		(token == 'module' && reModuleExports.test(chunkAfter)) ||
		(token == 'exports' && reExports.test(chunkAfter))
	) {
		// CommonJS modules use exports or module.exports.
		// AMD may use them, but a surrounding define should come first.
		state.record.format = 'cjs';
		return(true);
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
		const err = 'Parse error';

		/** Match string or comment start tokens, curly braces and some keywords. */
		let reToken = matchTokens('module|require|define|System|import|exports?');

		let last: number;
		let pos: number;

		/** Latest matched token. */
		let token: string;

		let state: TranslateState = {
			record,
			depth: 0
		};

		/** Finished trying to detect the module format? */
		let formatKnown = false;

		/** CommonJS style require call. Name can be remapped if used inside AMD. */
		let requireToken = 'require';

		let chunkBefore: string;
		let chunkAfter: string;

		let text = record.sourceCode;

		// Check for a hashbang header line.
		let match = reHashBang.exec(text);

		if(match) {
			// Remove the header.
			text = text.substr(match[0].length);
			record.sourceCode = text;

			// Anything meant to run as a script is probably CommonJS,
			// but keep trying to detect module type anyway.
			if(!formatKnown) record.format = 'cjs';
		}

		// Loop through all interesting tokens in the input string.
		while((match = reToken.exec(text))) {
			token = match[0];
			last = match.index;

			switch(token) {
				case '{':

					// Track nesting to detect top-level import / export.
					++state.depth;
					continue;

				case '}':

					--state.depth;
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
					chunkBefore = text.substr(pos, last - pos);

					if(!reBeforeRegExp.test(chunkBefore)) {
						continue;
					}

					last = skipRegExp(text, last);

					// Unterminated regular expressions are errors.
					if(last < 0) {
						throw(new Error(err));
					}

					break;

				case '"':
				case "'":
				case '`':

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
						(last > 0 && !sep[text.charAt(last - 1)]) ||
						(pos < text.length - 1 && !sep[text.charAt(pos)])
					) {
						continue;
					}

					if(!formatKnown) {
						formatKnown = guessFormat(token, text, last, pos, state);
					}

					if(
						token == requireToken &&
						(state.record.format == 'amd' || state.record.format == 'cjs')
					) {
						chunkAfter = text.substr(pos, chunkSize);

						match = reCallString.exec(chunkAfter);

						if(match && match[1] == match[3]) {
							// Called with a string surrounded in matching quotations.
							record.addDep(match[2]);
						}
					}

					continue;
			}

			// Jump ahead in input string if a comment, string or regexp was skipped.
			reToken.lastIndex = last + token.length;
		}
	}

}
