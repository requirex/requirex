import { keys } from '../platform/util';
import { ChangeSet } from './ChangeSet';
import { tokenize, StateStack, TokenizeConfig, FrameMode, sepList, reComments } from './tokenize';

export interface ParseConfig {

	/** Ranges of dead code and constant branch conditions
	  * detected by conditional compilation. */
	changeSet: ChangeSet;

	/** Test if a static if condition evaluates as true. Must return 0 or 1 or throw. */
	isTrue?: (condition: string) => 0 | 1;

	/** Table of keyword and variable names already detected and no longer needed by callbacks. */
	ignoreTbl: { [token: string]: true | undefined };

	/** Table of keywords triggering onKeyword. Values can be anything truthy. */
	keywordTbl: { [token: string]: any };

	/** Handle an interesting keyword in the code. */
	onKeyword?: (name: string, depth: number, pos: number) => void;

	/** Handle an interesting variable being referenced.
	  * Variables redefined in a code block will be ignored inside it. */
	onVariable?: (name: string, chunkAfter: string, isRedefined: boolean) => void;

	/** Table of variable names triggering onVariable. Values can be anything truthy. */
	variableTbl: { [token: string]: any };

}

/** Lookahead / behind buffer size to speed up matching surrounding tokens. */
const chunkSize = 128;

/** Create a regexp for matching string or comment start tokens,
  * angle brackets opening JSX elements, curly braces
  * (to track nested blocks) and given keywords.
  *
  * @param keywords Separated by pipe characters, may use regexp syntax. */

function matchTokens(keywords: string) {
	return new RegExp('[\n"\'`<{}()]|\/[*/]?|' + keywords, 'g');
}

/** Match a ".built(...)" method call (used after a "System" token). */
const reBuilt = /^\s*\.\s*built\s*\(\s*1\s*,/;

/** Match before a variable name means it gets redefined in the surrounding
  * block and loses any special meaning. */
const reIsDefinition = /(function|var|let|const)\s+([^,;}\r\n]*,\s*)*$/;

/** Match before a variable name means it gets redefined in the following
  * block and loses any special meaning. */
const reIsParamBefore = new RegExp(
	'function(\\s+[$_A-Za-z][^' + sepList + ']*)?\\s*\\(([^,)]*,\\s*)*$'
);

/** Match after a variable name means it gets redefined in the following
  * block or expression and loses any special meaning. */
const reIsParamAfter = new RegExp(
	'^((,\\s*[$_A-Za-z][^' + sepList + ']*\\s*)*\\))?\\s*=>'
);

/** Match any potential function call or assignment, including suspicious
  * comments before parens. Matching expressions should have no side effects
  * (except calling getters) and evaluation at compile time
  * (inside a try block) is safe. */
const reCallAssign = /(\*\/|[^-\t\n\r !"#%&'(*+,./:;<=>?@[\\^`{|~])\s*\(|[^!=]=[^=]|\+\+|--/;

/** Match an expression that must be constant in branch conditions,
  * because it does not refer to any variables. Useful for basic conditional
  * compilation / dead code elimination. */
const reConstant = /^([-\t\n\r !&()+,.<=>0-9|]+(true|false)?)+$/;

/** Match the start of a code block surrounded by curly braces. */
const reBlock = new RegExp('^' + reComments + '\\{');

/** Match an else statement after an if block. */
const reElse = new RegExp('^' + reComments + 'else' + reComments + '(if|\\{)');

interface TokenCallbackData {

	parseConfig: ParseConfig;
	tokenizeConfig: TokenizeConfig;

}

function onToken(
	data: TokenCallbackData,
	token: string,
	depth: number,
	pos: number,
	last: number,
	commentEnd?: number,
	before?: string
) {
	const { stack, text } = data.tokenizeConfig;
	const parser = data.parseConfig;
	const state = stack.get(depth);

	if(state.isDead) return;

	if(token == 'process.env' || token == 'NODE_ENV') {
		let d = depth;

		// Skip any nested parens inside if statement condition.
		while(d-- && stack.frames[d].rootToken == '(') {}

		if(d >= 0) {
			const frame = stack.frames[d];

			if(frame.mode == FrameMode.CONDITION) {
				frame.mode = FrameMode.STATIC_CONDITION;
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

	const parent = depth && stack.frames[depth - 1];

	// Handle end of "if" statement conditions
	// (this token is only emitted when tracking is enabled).
	// Detect constant branch conditions and dead code.

	if(token == ')' && parent && parent.mode != FrameMode.NONE && parser.isTrue) {
		/** Condition extracted from latest "if" statement. */
		let condition: string;

		if(!reBlock.test(text.substr(state.endOffset, chunkSize)) || (
			parent.mode != FrameMode.CONDITION &&
			parent.mode != FrameMode.STATIC_CONDITION
		)) {
			// Ensure a block delimited by curly braces follows
			// (finding endings of individual expressions is still unsupported).

			parent.mode = FrameMode.NONE;
		} else if(parent.wasAlive) {
			// If a previous block among the if-else statements was not
			// eliminated, all following "else" blocks must be.

			parent.mode = FrameMode.DEAD_BLOCK;
			parser.changeSet.add(state.startOffset + 1, state.endOffset - 1, '0');

			stack.track(depth - 1);
		} else {
			condition = text.substr(
				state.startOffset,
				state.endOffset - state.startOffset
			);

			if(
				(parent.mode == FrameMode.CONDITION && !reConstant.test(condition)) ||
				// Ensure the condition clearly has no side effects.
				reCallAssign.test(condition)
			) {
				parent.mode = FrameMode.NONE;
			} else {
				parent.mode = FrameMode.STATIC_CONDITION;
			}
		}

		if(parent.mode == FrameMode.STATIC_CONDITION) {
			try {
				// Prepare to handle an alive or dead block based on the conditions.
				const alive = parser.isTrue(condition!);

				parent.mode = alive ? FrameMode.ALIVE_BLOCK : FrameMode.DEAD_BLOCK;
				parser.changeSet.add(state.startOffset + 1, state.endOffset - 1, '' + alive);

				// If no errors were thrown, find the following
				// curly brace delimited block.
				stack.track(depth - 1);
			} catch(err) {
				// Stop conditional compilation if an error occurs.
				parent.mode = FrameMode.NONE;
			}
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
			parser.changeSet.add(state.startOffset + 1, state.endOffset - 1, '');
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

	if(parser.keywordTbl[token] && !parser.ignoreTbl[token] && parser.onKeyword) {
		parser.onKeyword(token, depth, pos);
	}

	if(parser.variableTbl[token] && !parser.ignoreTbl[token] && parser.onVariable) {
		// Get some input immediately before and after the token,
		// for quickly testing regexp matches.
		const chunkStart = Math.max(last - chunkSize, commentEnd || 0);
		const chunkBefore = text.substr(chunkStart, last - chunkStart);
		const chunkAfter = text.substr(pos, chunkSize);
		let scopeStartToken: RegExp | undefined;

		if(reIsDefinition.test(chunkBefore)) {
			(state.scope || (state.scope = {}))[token] = true;
		} else if(reIsParamBefore.test(chunkBefore)) {
			scopeStartToken = /\)\s*\{/;
		} else if(reIsParamAfter.test(chunkAfter)) {
			scopeStartToken = /=>\s*/;
		} else {
			parser.onVariable(token, chunkAfter, stack.lookup(token, depth));
		}

		if(scopeStartToken) {
			const match = chunkAfter.match(scopeStartToken);

			if(match) {
				(state.scopeNext || (state.scopeNext = {}))[token] = true;
				state.scopeStart = pos + match.index! + match[0].length + 2;
			}
		}
	}
}

/** Detect module format (AMD, CommonJS or ES) and report all CommonJS dependencies.
  * Optimized for speed. */

export function parse(
	text: string,
	uri: string,
	parseConfig: ParseConfig
) {
	const tokenizeConfig: TokenizeConfig<TokenCallbackData> = {
		onToken,
		// Match string or comment start tokens, curly braces and some keywords.
		reToken: matchTokens(
			keys(parseConfig.variableTbl).join('|') + '|' +
			keys(parseConfig.keywordTbl).join('|') + '|' +
			'if|process\\.env|NODE_ENV'
		),
		stack: new StateStack(),
		text,
		uri
	};

	const data: TokenCallbackData = {
		parseConfig,
		tokenizeConfig
	}

	tokenizeConfig.data = data;

	tokenize(tokenizeConfig);
}
