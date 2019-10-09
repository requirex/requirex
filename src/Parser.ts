import { Record, ModuleFormat } from './Record';
import { ChangeSet, Patch } from './ChangeSet';
import { features, makeTable } from './platform';

const chunkSize = 128;

/** Table of characters that may surround keyword and identifier names. */
const sepList = '\t\n\r !"#%&\'()*+,-./;<=>?@[\\]^`{|}~';
const sepBefore = makeTable(sepList, '');
const sepAfter = makeTable(sepList, '');

// Keywords may occur after a label or field name, not before.
// So a separating : must come before them, not after.
sepBefore[':'] = true;

/** Create a regexp for matching string or comment start tokens,
  * curly braces (to track nested blocks) and given keywords.
  *
  * @param keywords Separated by pipe characters, may use regexp syntax. */

function matchTokens(keywords: string) {
	return new RegExp('[\n"\'`<{}()]|\/[*/]?|' + keywords, 'g');
}

const reXML = /[<>"'`{]/g;

/** Match a function call with a non-numeric literal as the first argument. */
const reCallLiteral = /^\s*\(\s*["'`\[{_$A-Za-z]/;

// TODO: What types are valid for the first argument to System.register?
const reRegister = /^\s*\.\s*register\s*\(\s*["'`\[]/;

/** Match a ".built(...)" method call (used after a "System" token). */
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

/** Match any number of comments and whitespace. */
const reComments = '\\s*(//[^\n]*\n\\s*|/\\*[^*]*(\\*[^*/][^*]*)*\\*/\\s*)*';

/** Match a non-identifier, non-numeric character or return statement
  * before a regular expression or JSX element.
  * Example code seen in the wild: function(t){return/[A-Z]+/g.test(t)}
  * < is omitted to avoid confusion with closing JSX elements when detecting
  * a regexp, or << operators when detecting a JSX element. */
const reBeforeLiteral = new RegExp(
	'(^|[-!%&(*+,:;=>?\\[^{|}~]|[^*/]/)' + reComments + '(return\\s*)?$'
);

const reElement = /<\/?\s*([^ !"#%&'()*+,./:;<=>?@[\\\]^`{|}~]+)(\s+|\/?>)/;

/** Match any potential function call or assignment, including suspicious comments before parens. */
const reCallAssign = /(\*\/|[^-\t\n\r !"#%&'(*+,./:;<=>?@[\\^`{|~])\s*\(|[^!=]=[^=]|\+\+|--/;

const reBlock = new RegExp('^' + reComments + '\\{');

/** Match an else statement after an if block. */
const reElse = new RegExp('^' + reComments + 'else' + reComments + '(if|\\{)');

const reStringEnd = {
	"'": /['\n]/g,
	'"': /["\n]/g,
	'`': /[`\n]/g
};

const reCommentEnd = /\n|\*\//g;

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
	FROM_XML,
	FROM_JS
}

class StackItem implements Patch {

	constructor() {
		this.clear();
	}

	clear(parent?: StackItem) {
		this.mode = ConditionMode.NONE;
		this.conditionStart = 0;
		this.wasAlive = false;

		if(parent) {
			this.isDead = parent.isDead || parent.mode == ConditionMode.DEAD_BLOCK;
		}

		return this;
	}

	rootToken: string;

	tracking?: boolean;
	startOffset = 0;
	startRow = 0;
	startCol = 0;
	endOffset = 0;
	endRow = 0;
	endCol = 0;

	mode: ConditionMode;

	/** Start offset of "if" statement condition. */
	conditionStart: number;

	/** Flag whether any block seen so far in a set of conditionally
	  * compiled if-else statements was not eliminated. */
	wasAlive: boolean;

	/** Inside an always false condition or bundled code,
	  * to be ignored in parsing. */
	isDead: boolean;

	element?: string;
	isClosing?: boolean;

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

			case '\n':

				return -1;

			case '/':

				// A slash terminates the regexp unless inside a character class.
				if(!inClass) return pos;
		}
	}

	return -1;
}

export class UnterminatedError extends Error {

	/** @param row Source line number (zero-based).
	  * @param col Source column number (zero-based). */

	// constructor(kind: string, public uri: string, public row: number, public col: number) {
	constructor(kind: string, row: number, text: string, uri?: string) {
		let col = 0;

		for(let pos = 0; pos < text.length; ++pos) {
			if(text.charAt(pos) == '\t') col |= 7;
			++col;
		}

		super(
			'Parse error: Unterminated ' + kind +
			(!uri ? '' : ' in ' + uri) +
			' on line ' + (row + 1) +
			' column ' + (col + 1)
		);

		this.row = row;
		this.col = col;
		this.uri = uri;
	}

	row: number;
	col: number;
	uri?: string;

}

function parseSyntax(parser: TranslateConfig, uri?: string) {
	let reToken = parser.reToken;
	const stack = parser.stack;
	const text = parser.text;
	let row = 0;
	let rowOffset = 0;
	/** Nesting depth inside curly brace delimited blocks. */
	let depth = 0;
	let state: StackItem;
	let match: RegExpExecArray | null;
	let parts: RegExpMatchArray | null;
	/** Latest matched token. */
	let token: string;
	let last: number;
	let pos = 0;
	let before: string;
	let after: string;
	let oldRow: number;
	let oldOffset: number;
	/** Flag whether token is inside a JSX text node. */
	let isText = false;
	let re: RegExp;

	// Loop through all interesting tokens in the input string.
	while((match = reToken.exec(text))) {
		token = match[0];
		last = match.index;

		switch(token) {
			case '(': case '{': case '[':

				state = stack.get(depth + 1).clear(stack.items[depth]);
				state.rootToken = token;

				if(state.tracking) {
					state.startOffset = last;
					state.startRow = row;
					state.startCol = last - rowOffset;
				}

				++depth;

				if(reToken != parser.reToken) {
					state.mode = ConditionMode.FROM_XML;
					reToken = parser.reToken;
					break;
				}

				continue;

			case ')': case '}': case ']':

				state = stack.get(depth);

				if(state.tracking) {
					state.endOffset = last + 1;
					state.endRow = row;
					state.endCol = last - rowOffset + 1;
					state.tracking = false;

					// Ensure } token terminating a dead block still gets parsed.
					state.isDead = stack.items[depth - 1].isDead;
					parser.handler(token, depth, pos, last);
				}

				--depth;

				if(state.mode == ConditionMode.FROM_XML) {
					reToken = reXML;
					break;
				}

				continue;

			case '/*':

				// Skip a comment. Find and jump past the end token.
				re = reCommentEnd;
				re.lastIndex = last + 2;
				oldRow = row;
				oldOffset = rowOffset;

				while((match = re.exec(text)) && match[0] == '\n') {
					++row;
					rowOffset = match.index + 1;
				}

				if(!match) {
					throw new UnterminatedError(
						'comment',
						oldRow,
						text.substring(oldOffset, last),
						uri
					);
				}

				last = match.index;

				break;

			case '//':

				token = '\n';
				last = text.indexOf(token, last + 2);

				if(last < 0) return;

			case '\n':

				++row;
				rowOffset = last + token.length;

				break;

			case '/':

				// Test if the slash begins a regular expression.
				pos = Math.max(last - chunkSize, 0);

				if(!reBeforeLiteral.test(text.substr(pos, last - pos))) {
					continue;
				}

				last = skipRegExp(text, last);

				if(last < 0) {
					throw new UnterminatedError(
						'regexp',
						row,
						text.substring(rowOffset, match.index),
						uri
					);
				}

				break;

			case '<':

				// Test if the angle bracket begins a JSX element.
				pos = Math.max(last - chunkSize, 0);

				if(
					(reToken == reXML || reBeforeLiteral.test(text.substr(pos, last - pos))) &&
					(parts = text.substr(last, chunkSize).match(reElement))
				) {
					if(text.charAt(last + 1) != '/') {
						state = stack.get(depth + 1).clear(stack.items[depth]);
						state.element = parts[1];
						state.isClosing = false;

						++depth;
					} else {
						state = stack.get(depth);
						state.isClosing = true;

						if(parts[1] != state.element) {
							throw new UnterminatedError(
								state.element + ' element',
								row,
								text.substring(rowOffset, match.index),
								uri
							);
						}
					}

					isText = false;

					if(reToken == parser.reToken) {
						state.mode = ConditionMode.FROM_JS;
						reToken = reXML;
						break;
					}
				}

				continue;

			case '>':

				state = stack.get(depth);

				if(text.charAt(last - 1) == '/' || state.isClosing) {
					--depth;

					if(state.mode == ConditionMode.FROM_JS) {
						reToken = parser.reToken;
						isText = false;
						break;
					}
				}

				isText = true;
				continue;

			case '`':

				if(!isText) parser.handler(token, depth, pos, last);

			case '"': case "'":

				if(isText) continue;

				// Skip a string.
				re = reStringEnd[token];
				re.lastIndex = last + 1;
				oldRow = row;
				oldOffset = rowOffset;

				do {
					// Look for a matching quote.
					while((match = re.exec(text)) && token == '`' && match[0] == '\n') {
						++row;
						rowOffset = match.index + 1;
					}

					if(!match || match[0] == '\n') {
						throw new UnterminatedError(
							'string',
							oldRow,
							text.substring(oldOffset, last),
							uri
						);
					}

					last = match.index;
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

export class Parser implements TranslateConfig {

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
		const parent = depth && stack.items[depth - 1];

		// Handle end of "if" statement conditions (this token is only
		// emitted when tracking is turned on).

		if(token == ')' && parent) {
			// Ensure a NODE_ENV constant was seen and a block delimited
			// by curly braces follows (parsing individual expressions
			// is still unsupported).

			if(
				parent.mode == ConditionMode.STATIC_CONDITION &&
				reBlock.test(text.substr(state.endOffset, chunkSize))
			) {
				if(parent.wasAlive) {
					// If a previous block among the if-else statements
					// was not eliminated, all following "else" blocks
					// must be.

					parent.mode = ConditionMode.DEAD_BLOCK;
					this.changeSet.add(state, '0', 1, -1);

					stack.track(depth - 1);
				} else {
					// Stop conditional compilation if an error occurs.
					parent.mode = ConditionMode.NONE;

					/** Condition extracted from latest "if" statement. */
					const condition = text.substr(
						state.startOffset,
						state.endOffset - state.startOffset
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
						this.changeSet.add(state, '' + alive, 1, -1);

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
				this.changeSet.add(state, '', 1, -1);
				// Prepare for an "else" statement.
				if(!parent.wasAlive) parent.mode = ConditionMode.ALIVE_BLOCK;
			}

			/** Match a following "else" statement followed by an "if" or
			  * curly brace delimited block. */
			const elseMatch = text.substr(state.endOffset!, chunkSize).match(reElse);

			if(elseMatch) {
				parent.conditionStart = state.endOffset! + elseMatch[0].length - 1;
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

	parse() {
		parseSyntax(this, this.record.resolvedKey);
		return this;
	}

	/** Finished trying to detect the module format? */
	formatKnown: boolean;

	/** Match string or comment start tokens, curly braces and some keywords. */
	reToken = matchTokens('module|require|define|System|import|exports?|if|NODE_ENV|let|const|=>');

	/** CommonJS style require call. Name can be remapped if used inside AMD. */
	requireToken = 'require';

	stack = new StateStack();

	changeSet = new ChangeSet();

}
