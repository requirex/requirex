import { Record, ModuleFormat } from './Record';
import { ChangeSet } from './ChangeSet';
import { features, makeTable } from './platform';

/** Lookahead / behind buffer size to speed up matching surrounding tokens. */
const chunkSize = 128;

/** Table of characters that may surround keyword and identifier names. */
const sepList = '\t\n\r !"#%&\'()*+,-./;<=>?@[\\]^`{|}~';
const sepBefore = makeTable(sepList, '');
const sepAfter = makeTable(sepList, '');

// Keywords may occur after a label or field name, not before.
// So a separating : must come before them, not after.
sepBefore[':'] = true;

/** Create a regexp for matching string or comment start tokens,
  * angle brackets opening JSX elements, curly braces
  * (to track nested blocks) and given keywords.
  *
  * @param keywords Separated by pipe characters, may use regexp syntax. */

function matchTokens(keywords: string) {
	return new RegExp('[\n"\'`<{}()]|\/[*/]?|' + keywords, 'g');
}

/** Match characters relevant when inside JSX elements. */
const reXML = /[<>"'`{]/g;

/** Match a function call with a non-numeric literal as the first argument
  * (to detect AMD define calls). */
const reCallLiteral = /^\s*\(\s*["'`\[{_$A-Za-z]/;

// TODO: What types are valid for the first argument to System.register?
const reRegister = /^\s*\.\s*register\s*\(\s*["'`\[]/;

/** Match a ".built(...)" method call (used after a "System" token). */
const reBuilt = /^\s*\.\s*built\s*\(\s*1\s*,/;

/** Match a string or template literal.
  * NOTE: Unescaped dollar signs are prohibited but line breaks are allowed in
  * template literals. */
export const reString = (
	'"([^\n\\\\"]|\\\\[^\r\n])*"|' +
	"'([^\n\\\\']|\\\\[^\r\n])*'|" +
	'`([^\$\\\\`]|\\\\.)*`'
);

/** Match a function call with a string argument. */
const reCallString = new RegExp('^\\s*\\(\\s*(' + reString + ')\\s*\\)');

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

/** Match the start of a JSX element: angle bracket, name, and whitespace or closing bracket.
  * A slash next to one of the brackets is optional. */
const reElement = /<\/?\s*([^ !"#%&'()*+,./:;<=>?@[\\\]^`{|}~]+)(\s+|\/?>)/;

/** Match any potential function call or assignment, including suspicious
  * comments before parens. Matching expressions should have no side effects
  * (except calling getters) and evaluation at compile time
  * (inside a try block) is safe. */
const reCallAssign = /(\*\/|[^-\t\n\r !"#%&'(*+,./:;<=>?@[\\^`{|~])\s*\(|[^!=]=[^=]|\+\+|--/;

/** Match the start of a code block surrounded by curly braces. */
const reBlock = new RegExp('^' + reComments + '\\{');

/** Match an else statement after an if block. */
const reElse = new RegExp('^' + reComments + 'else' + reComments + '(if|\\{)');

/** Regexps to find matching quote characters and track newlines inside strings. */
const reStringEnd = {
	"'": /['\n]/g,
	'"': /["\n]/g,
	'`': /[`\n]/g
};

/** Match end of multiline comment and track newlines to support row / column numbers. */
const reCommentEnd = /\n|\*\//g;

const enum FrameMode {
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
	/** Outermost JSX element, surrounded by JS code. */
	FROM_XML,
	/** Outermost JS block, surrounded by JSX elements. */
	FROM_JS
}

/** Represents one nesting level (code block, paren or JSX element)
  * in the parser state stack. */

class StackFrame {

	constructor() {
		this.clear();
	}

	/** Reset stack frame fields which the parser expects initially unset.
	  *
	  * @param parent Parent stack frame to track if inside known-dead code. */

	clear(parent?: StackFrame) {
		this.mode = FrameMode.NONE;
		this.conditionStart = 0;
		this.wasAlive = false;

		if(parent) {
			this.isDead = parent.isDead || parent.mode == FrameMode.DEAD_BLOCK;
		}

		return this;
	}

	rootToken: string;

	/** If enabled, track locations of surrounding braces, brackets and parens. */
	tracking?: boolean;
	/** Offset in source code to brace, bracket or paren starting this stack frame. */
	startOffset = 0;
	startRow = 0;
	/** NOTE: tab size = 1 for source map support. */
	startCol = 0;
	/** Offset in source code to brace, bracket or paren ending this stack frame. */
	endOffset = 0;
	endRow = 0;
	/** NOTE: tab size = 1 for source map support. */
	endCol = 0;

	/** Semantic meaning of the stack frame if relevant. */
	mode: FrameMode;

	/** Start offset of "if" statement condition. */
	conditionStart: number;

	/** Flag whether any block seen so far in a set of conditionally
	  * compiled if-else statements was not eliminated. */
	wasAlive: boolean;

	/** Inside an always false condition or bundled code,
	  * to be ignored in parsing. */
	isDead: boolean;

	/** Name to ensure opening and closing JSX elements match. */
	element?: string;
	/** Flag whether element is closing (starts with a slash). */
	isClosing?: boolean;

}

class StateStack {

	get(depth: number) {
		return this.frames[depth] || (this.frames[depth] = new StackFrame());
	}

	/** Track start and end offsets of parens and braces,
	  * call handler when they end. */

	track(depth: number) {
		this.get(depth + 1).tracking = true;
	}

	frames: StackFrame[] = [new StackFrame()];

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
	/** Nesting depth inside curly brace delimited blocks, JSX elements... */
	let depth = 0;
	let state: StackFrame;
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

				state = stack.get(depth + 1).clear(stack.frames[depth]);
				state.rootToken = token;

				if(state.tracking) {
					state.startOffset = last;
					state.startRow = row;
					state.startCol = last - rowOffset;
				}

				++depth;

				if(reToken != parser.reToken) {
					state.mode = FrameMode.FROM_XML;
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
					state.isDead = stack.frames[depth - 1].isDead;
					parser.handler(token, depth, pos, last);
				}

				--depth;

				if(state.mode == FrameMode.FROM_XML) {
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
					// Test if token is inside a text node or
					// in a valid place for a JS literal.
					(isText || reBeforeLiteral.test(text.substr(pos, last - pos))) &&
					// Match the start of a JSX element.
					(parts = text.substr(last, chunkSize).match(reElement))
				) {
					if(text.charAt(last + 1) != '/') {
						// Capture an opening element in the stack.
						state = stack.get(depth + 1).clear(stack.frames[depth]);
						state.element = parts[1];
						state.isClosing = false;

						++depth;
					} else {
						// Prepare to pop a closing element off the stack.
						state = stack.get(depth);
						state.isClosing = true;

						// Ensure name matches opening element.
						if(parts[1] != state.element) {
							throw new UnterminatedError(
								state.element + ' element',
								row,
								text.substring(rowOffset, match.index),
								uri
							);
						}
					}

					// Currently inside an element, not a text node.
					isText = false;

					// Ensure tokens relevant to JSX elements are matched next.
					if(reToken != reXML) {
						state.mode = FrameMode.FROM_JS;
						reToken = reXML;
						break;
					}
				}

				continue;

			case '>':

				// Closing angle brackets are relevant only when parsing JSX.
				if(reToken != reXML) continue;

				state = stack.get(depth);

				if(text.charAt(last - 1) == '/' || state.isClosing) {
					// Pop closing element off the stack.
					--depth;

					parser.handler(token, depth, pos, last);

					if(state.mode == FrameMode.FROM_JS) {
						reToken = parser.reToken;
						isText = false;
						break;
					}
				}

				// Text nodes may follow elements.
				isText = true;
				continue;

			case '`':

				if(!isText) parser.handler(token, depth, pos, last);

			case '"': case "'":

				if(isText) continue;

				// Skip a string.
				// Note that dependencies referred in template literals like
				// `${require('react')}` are not detected.
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
	'require': ['cjs', false, reCallLiteral, null],
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
				const up = stack.frames[conditionDepth];

				if(up.rootToken != '(') {
					if(up.mode == FrameMode.CONDITION) {
						up.mode = FrameMode.STATIC_CONDITION;
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

			if(state.mode == FrameMode.NONE) {
				state.wasAlive = false;
			}

			state.mode = FrameMode.CONDITION;
			// Track "if" statement conditions.
			stack.track(depth);
		}

		const record = this.record;
		const parent = depth && stack.frames[depth - 1];

		// Handle end of "if" statement conditions (this token is only
		// emitted when tracking is turned on).

		if(token == ')' && parent) {
			// Ensure a NODE_ENV constant was seen and a block delimited
			// by curly braces follows (parsing individual expressions
			// is still unsupported).

			if(
				parent.mode == FrameMode.STATIC_CONDITION &&
				reBlock.test(text.substr(state.endOffset, chunkSize))
			) {
				if(parent.wasAlive) {
					// If a previous block among the if-else statements
					// was not eliminated, all following "else" blocks
					// must be.

					parent.mode = FrameMode.DEAD_BLOCK;
					this.changeSet.add(state.startOffset + 1, state.endOffset - 1, '0');

					stack.track(depth - 1);
				} else {
					// Stop conditional compilation if an error occurs.
					parent.mode = FrameMode.NONE;

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

						parent.mode = alive ? FrameMode.ALIVE_BLOCK : FrameMode.DEAD_BLOCK;
						this.changeSet.add(state.startOffset + 1, state.endOffset - 1, '' + alive);

						// If no errors were thrown, find the following
						// curly brace delimited block.
						stack.track(depth - 1);
					} catch(err) { }
				}
			} else {
				parent.mode = FrameMode.NONE;
			}
		}

		// Handle a just parsed, conditionally compiled curly brace
		// delimited block.

		if(token == '}' && parent && parent.mode != FrameMode.NONE) {
			const alive = parent.mode == FrameMode.ALIVE_BLOCK;
			parent.wasAlive = parent.wasAlive || alive;

			if(alive) {
				// Set mode for next block in case of an "else" statement.
				parent.mode = FrameMode.DEAD_BLOCK;
			} else {
				// Remove dead code.
				this.changeSet.add(state.startOffset + 1, state.endOffset - 1, '');
				// Prepare for an "else" statement.
				if(!parent.wasAlive) parent.mode = FrameMode.ALIVE_BLOCK;
			}

			/** Match a following "else" statement followed by an "if" or
			  * curly brace delimited block. */
			const elseMatch = text.substr(state.endOffset!, chunkSize).match(reElse);

			if(elseMatch) {
				parent.conditionStart = state.endOffset! + elseMatch[0].length - 1;
				stack.track(depth - 1);
			} else {
				parent.mode = FrameMode.NONE;
			}
		}

		if(
			(
				// ES modules contain import and export statements
				// at the root level scope.
				(token == 'import' || token == 'export') && !depth
			) || (
				!features.isES6 &&
				// TODO: Also detect object key value shorthand notation.
				(token == '`' || token == 'let' || token == 'const' || token == '=>') &&
				(!record.format || record.format == 'js')
			)
		) {
			record.format = this.hasElements ? 'tsx' : 'ts';
			this.formatKnown = true;
		}

		if(token == '>') {
			this.hasElements = true;

			if(record.format == 'js' || record.format == 'ts') {
				// JSX element detected, update format.
				record.format += 'x';
			}
		}

		if(!this.formatKnown) {
			this.formatKnown = this.guessFormat(token, depth, pos, last);
		}

		if(token == this.requireToken) {
			const chunkAfter = text.substr(pos, chunkSize);
			const match = reCallString.exec(chunkAfter);

			if(match) {
				// Called with a string surrounded in matching quotations.
				record.addDep(match[1].substr(1, match[1].length - 2));
			}
		}
	}

	parse() {
		parseSyntax(this, this.record.resolvedKey);
		return this;
	}

	/** Finished trying to detect the module format? */
	formatKnown: boolean;

	hasElements: boolean;

	/** Match string or comment start tokens, curly braces and some keywords. */
	reToken = matchTokens('module|require|define|System|import|exports?|if|NODE_ENV|let|const|=>');

	/** CommonJS style require call. Name can be remapped if used inside AMD. */
	requireToken = 'require';

	stack = new StateStack();

	changeSet = new ChangeSet();

}
