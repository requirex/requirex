import { makeTable } from '../platform/util';

/** Lookahead / behind buffer size to speed up matching surrounding tokens. */
const chunkSize = 128;

/** Table of characters that may surround keyword and identifier names. */
export const sepList = '-\t\n\r !"#%&\'()*+,./:;<=>?@[\\\\\\]^`{|}~';
const sepBefore = makeTable(sepList, '');
const sepAfter = makeTable(sepList, '');

// Keywords may occur after a label or field name, not before.
// So a separating : must come before them, not after.
// This avoids reporting labels and object literal field names as keywords.
sepAfter[':'] = false;

/** Match characters relevant when inside JSX elements. */
const reXML = /[<>"'`{]/g;

/** Match any number of comments and whitespace. */
export const reComments = '\\s*(//[^\n]*\n\\s*|/\\*[^*]*(\\*[^*/][^*]*)*\\*/\\s*)*';

/** Match a non-identifier, non-numeric character or return statement
  * before a regular expression or JSX element.
  * Example code seen in the wild: function(t){return/[A-Z]+/g.test(t)}
  * < is omitted to avoid confusion with closing JSX elements when detecting
  * a regexp, or << operators when detecting a JSX element. */
const reBeforeLiteral = new RegExp(
	'(^|[-!%&(*+,:;=>?\\[^{|}~]|[^*/]/)' + reComments + '((return|throw)\\s*)?$'
);

/** Match the start of a JSX element: angle bracket, name, and whitespace or closing bracket.
  * A slash next to one of the brackets is optional. */
const reElement = new RegExp('</?\s*([^' + sepList + ']+)(\s+|/?>)');

/** Regexps to find matching quote characters and track newlines inside strings. */
const reStringEnd = {
	"'": /['\n]/g,
	'"': /["\n]/g,
	'`': /[`\n]/g
};

/** Match end of multiline comment and track newlines to support row / column numbers. */
const reCommentEnd = /\n|\*\//g;

export const enum FrameMode {
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

	clear(last?: number, parent?: StackFrame) {
		this.mode = FrameMode.NONE;
		this.conditionStart = 0;
		this.wasAlive = false;

		if(parent) {
			this.isDead = parent.isDead || parent.mode == FrameMode.DEAD_BLOCK;
			if(parent.scopeStart > this.scopeStart) {
				this.scopeNext = parent.scopeNext;
				this.scopeStart = parent.scopeStart;
			}
		}

		this.scope = (last || 0) < this.scopeStart && this.scopeNext;
		this.scopeNext = void 0;

		return this;
	}

	rootToken?: string;

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
	mode?: FrameMode;

	/** Start offset of "if" statement condition. */
	conditionStart?: number;

	/** Flag whether any block seen so far in a set of conditionally
	  * compiled if-else statements was not eliminated. */
	wasAlive?: boolean;

	/** Inside an always false condition or bundled code,
	  * to be ignored in parsing. */
	isDead?: boolean;

	/** Special variables redefined in this scope. */
	scope?: {[name: string]: boolean} | false;

	/** Special variables redefined in the next sibling scope. */
	scopeNext?: {[name: string]: boolean};

	/** Required maximum start position of next sibling or child scope,
	  * for variable redefinitions to apply. */
	scopeStart = 0;

	/** Name to ensure opening and closing JSX elements match. */
	element?: string;
	/** Flag whether element is closing (starts with a slash). */
	isClosing?: boolean;

}

export class StateStack {

	get(depth: number) {
		return this.frames[depth] || (this.frames[depth] = new StackFrame());
	}

	/** Track start and end offsets of parens and braces,
	  * call handler when they end. */

	track(depth: number) {
		this.get(depth + 1).tracking = true;
	}

	lookup(name: string, depth: number) {
		do {
			const frame = this.frames[depth];
			if(frame.scope && frame.scope[name]) return true;
		} while(depth--);

		return false;
	}

	frames: StackFrame[] = [new StackFrame()];

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

export interface TokenizeConfig<Data = any> {

	data?: Data;

	uri?: string;

	onToken(
		data: Data,
		token: string,
		depth: number,
		pos: number,
		last: number,
		commentEnd?: number,
		before?: string,
		after?: string
	): void;

	reToken: RegExp;

	stack: StateStack;

	/** String of code to parse. */
	text: string;

}

export function tokenize(config: TokenizeConfig) {
	let reToken = config.reToken;
	const { data, onToken, stack, text, uri } = config;
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
	let commentEnd = 0;

	// Loop through all interesting tokens in the input string.
	while((match = reToken.exec(text))) {
		token = match[0];
		last = match.index;

		switch(token) {
			case '(': case '{': case '[':

				state = stack.get(depth + 1).clear(last, stack.frames[depth]);
				state.rootToken = token;

				if(state.tracking) {
					state.startOffset = last;
					state.startRow = row;
					state.startCol = last - rowOffset;
				}

				++depth;

				if(reToken != config.reToken) {
					state.mode = FrameMode.FROM_XML;
					reToken = config.reToken;
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
					onToken(data, token, depth, pos, last);
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
				commentEnd = last;

				break;

			case '//':

				token = '\n';
				last = text.indexOf(token, last + 2);
				commentEnd = last;

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
						state = stack.get(depth + 1).clear(last, stack.frames[depth]);
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

					onToken(data, token, depth, pos, last);

					if(state.mode == FrameMode.FROM_JS) {
						reToken = config.reToken;
						isText = false;
						break;
					}
				}

				// Text nodes may follow elements.
				isText = true;
				continue;

			case '`':

				if(!isText) onToken(data, token, depth, pos, last);

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
					onToken(data, token, depth, pos, last, commentEnd, before);
				}

				continue;
		}

		// Jump ahead in input string if a comment, string or regexp was skipped.
		reToken.lastIndex = last + token.length;
	}
}
