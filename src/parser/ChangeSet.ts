// Track offsets for patching code, row and col for patching source maps.

export type Patch = [
	/** Start offset. */
	number,
	/** End offset. */
	number,
	/** Replacement. */
	string
];

/** Replace code without invalidating source maps, by commenting it out
  * or replacing it with spaces.
  *
  * @param src Original code to modify.
  * @param dst Replacement code.
  * Must not be longer than src or contain line breaks.
  *
  * @return Code in dst followed by commented out src or space characters. */

export function replaceCode(src: string, dst: string) {
	const srcLen = src.length;
	const diff = srcLen - dst.length;
	let pos = src.lastIndexOf('\n') + 1;
	let result: string;

	// Replace comment block endings with *\ in input to avoid syntax errors
	// when commenting it out.
	src = src.replace(/\*\//g, '*\\');

	if(pos) {
		let last: string;

		if(pos < srcLen - 1) {
			// If original has line breaks and last line has over 2 chars,
			// move the first 2 chars to previous line and append "*/".
			last = '\n' + src.substr(pos + 2) + '*/';
		} else {
			// If original has line breaks and last line has up to one char,
			// append it and " */" to previous line and replace the char
			// (if present) with a space.
			last = ' */\n' + (pos < srcLen ? ' ' : '');
		}

		result = (
			dst + (dst ? ' ' : '') + '/* ' + src.substr(0, pos - 1) + ' ' + src.substr(pos, 2)
		).replace(/[ \t]+$/g, '') + last;
	} else if(diff > 7) {
		// If original has no line breaks and is long enough, surround it with
		// a comment block, truncate and append ellipsis.
		result = dst + ' /*' + src.substr(0, diff - 8) + '...*/';
	} else {
		// If original has no line breaks and is very short, replace by blank
		// spaces to match its length.
		result = dst + '       '.substr(7 - diff);
	}

	return result;
}

export class ChangeSet {

	add(startOffset: number, endOffset: number, replacement: string) {
		this.patches.push([startOffset, endOffset, replacement]);
		return this;
	}

	/** Apply patches to source code string.
	  *
	  * @return patched string. */

	patchCode(code: string) {
		if(!this.patches.length) return code;

		let result = '';
		let pos = 0;

		for(let [startOffset, endOffset, replacement] of this.patches) {
			result += code.substr(pos, startOffset - pos) + replaceCode(code.substr(startOffset, endOffset - startOffset), replacement);
			pos = endOffset;
		}

		return result + code.substr(pos);
	}

	/** String replacements to apply to input source code, similar to array.splice. */
	patches: Patch[] = [];

}
