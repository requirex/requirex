import { URL } from './URL';
import { encode64 } from '@lib/base64';
import { encodeVLQ, decodeVLQ } from '@lib/base64-vlq';
import { ChangeSet } from './ChangeSet';

/** See https://sourcemaps.info/spec.html */

export interface SourceMapData {
	version: number;
	file?: string;
	sourceRoot?: string;
	sources: string[];
	sourcesContent?: (string | null)[];
	names: string[];
	mappings: string;
}

export interface SourceMapSpec {
	key: string;
	code?: string;
}

const emptySpec: SourceMapSpec = { key: '' };

export class SourceMap {

	constructor(baseKey: string, data: string, keyTbl?: { [key: string]: SourceMapSpec }) {
		const json: SourceMapData = JSON.parse(data);
		const sources = json.sources || [];
		const content = json.sourcesContent || [];
		const root = json.sourceRoot || '';

		for(let num = 0; num < sources.length; ++num) {
			const key = URL.resolve(baseKey, root + sources[num]);
			const spec = keyTbl ? keyTbl[key] : emptySpec;

			sources[num] = spec.key || key;
			content[num] = spec.code || content[num] || null;
		}

		json.sourcesContent = content;

		// Inline source maps always apply to the file they're in anyway.
		delete json.file;
		this.json = json;
	}

	patchChunk(startRow: number, startCol: number, endRow: number, endCol: number, replacement: string) {
		const map = this.json.mappings;
		const mapLen = map.length;
		let groupPos = 0;
		let genRow = 0;

		// Skip to row where patch starts.
		while(genRow < startRow && (groupPos = map.indexOf(';', groupPos) + 1)) {
			++genRow;
		}

		const buf: number[] = [];

		let groupEnd = 0;
		let segPos = 0;
		let segEnd: number;
		let count: number;

		let genCol: number;
		let deltaFile = 0;
		let deltaRow = 0;
		let deltaCol = 0;
		let deltaGen = 0;

		let removeStart = groupPos;
		let removeEnd = -1;

		while(genRow <= endRow && groupEnd < mapLen) {
			genCol = 0;
			groupEnd = (map.indexOf(';', groupPos) + 1 || mapLen + 1);
			if(genRow == endRow) removeEnd = groupEnd - 1;

			segPos = groupPos;

			do {
				segEnd = (map.indexOf(',', segPos) + 1 || groupEnd);
				if(segEnd > groupEnd) segEnd = groupEnd;

				count = decodeVLQ(map, buf, 0, segPos, segEnd - 1);

				genCol += +(count > 0) && buf[0];
				deltaFile += +(count > 1) && buf[1];
				deltaRow += +(count > 2) && buf[2];
				deltaCol += +(count > 3) && buf[3];

				if(genRow == startRow && genCol <= startCol) {
					removeStart = segEnd;
					deltaFile = 0;
					deltaRow = 0;
					deltaCol = 0;
				}

				if(genRow == endRow && genCol >= endCol) {
					removeEnd = segPos;
					break;
				}

				segPos = segEnd;
			} while(segEnd < groupEnd);

			++genRow;
			groupPos = groupEnd;
		}

		if(removeEnd < 0) removeEnd = mapLen;
		if(removeStart > removeEnd) removeStart = removeEnd;

		let lines = '';
		let pos = 0;
		let rowOffset = 0;

		while((pos = replacement.indexOf('\n', pos) + 1)) {
			lines += ';';
			rowOffset = pos;
		}

		deltaGen += replacement.length - rowOffset;

		let insert = '';

		if(deltaGen || deltaFile || deltaRow || deltaCol) {
			if(removeStart > 0 && !lines && map.charAt(removeStart - 1) != ';') {
				insert = ',';
			}

			// TODO: insert += encodeVLQ([deltaGen, deltaFile, deltaRow, deltaCol]);
		}

		this.json.mappings = map.substr(0, removeStart) + lines + insert + map.substr(removeEnd);
	}

	patchOutput(changeSet: ChangeSet) {
		for(let patch of changeSet.patches) {
			this.patchChunk(patch.startRow, patch.startCol, patch.endRow, patch.endCol, patch.replacement || '');
		}

		return this;
	}

	unpatchInput(changeSet: ChangeSet) {
		const map = this.json.mappings;
		const patch = changeSet.patches[0];

		if(patch) {
			this.json.mappings = encodeVLQ([0, 0, patch.endRow, patch.endCol]) + (map.charAt(0) == ';' ? '' : ',') + map;
		}
	}

	encodeURL() {
		return 'data:application/json;charset=utf-8;base64,' + encode64(JSON.stringify(this.json));
	}

	static removeComment(code: string) {
		return code.replace(/\/[*/]# source[^*\n]+(\*\/)?\n?/g, '');
	}

	json: SourceMapData;

}
