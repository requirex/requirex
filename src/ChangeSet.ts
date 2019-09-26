// Track offsets for patching code, row and col for patching source maps.

export interface Patch {

	startOffset: number;
	startRow: number;
	/** Tab size is 1. */
	startCol: number;

	endOffset: number;
	endRow: number;
	/** Tab size is 1. */
	endCol: number;

	replacement?: string;

}

export class ChangeSet {

	add(patch: Patch, startColOffset = 0, endColOffset = 0, replacement = '') {
		this.patches.push({
			startOffset: patch.startOffset + startColOffset,
			startRow: patch.startRow,
			startCol: patch.startCol + startColOffset,
			endOffset: patch.endOffset + endColOffset,
			endRow: patch.endRow,
			endCol: patch.endCol + endColOffset,
			replacement: replacement
		});
	}

	/** Apply patches to source code string.
	  *
	  * @return patched string. */

	patchCode(code: string) {
		if(!this.patches.length) return code;

		let result = '';
		let pos = 0;

		for(let {startOffset, endOffset, replacement} of this.patches) {
			result += code.substr(pos, startOffset - pos) + replacement;
			pos = endOffset;
		}

		return result + code.substr(pos);
	}

	/** String replacements to apply to input source code, similar to array.splice. */
	patches: Patch[] = [];

}