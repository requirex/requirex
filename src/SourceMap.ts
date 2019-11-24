import { URL } from './URL';
import { encode64 } from '@lib/base64';

/** See https://sourcemaps.info/spec.html */

export interface SourceMapData {
	version: 3;
	file?: string;
	/** Base address for all source files. */
	sourceRoot?: string;
	/** Original source file addresses (appended to sourceRoot). */
	sources: string[];
	/** Original source file contents, listed in the same order as addresses. */
	sourcesContent?: (string | null)[];
	names?: string[];
	/** Line and column mapping data encoded using Base64-VLQ. */
	mappings: string;
}

export interface IndexMapData {
	version: 3;
	file?: string;
	sections: {
		offset: { line: number, column: number },
		url?: string,
		map?: SourceMapData
	}[]
}

export interface SourceMapSpec {
	/** Custom address to show as file origin. */
	key: string;
	/** Custom contents to show for file. */
	code?: string;
}

const emptySpec: SourceMapSpec = { key: '' };

export class SourceMap {

	/** Construct a source map from Base64-encoded or JSON data.
	  *
	  * @param url Base64-encoded sourceMappingURL with MIME type prefix,
	  * or address of transpiled code if a source map is given in JSON format.
	  * @param data Source map in JSON format.
	  * @param keyTbl Map original source code addresses to custom addresses
	  * and file contents to bundle with the source map. */

	constructor(url: string, data?: string | SourceMapData | IndexMapData, keyTbl?: { [key: string]: SourceMapSpec }) {
		if(!data) {
			this.encoded = url;
		} else {
			if(typeof data == 'string') data = JSON.parse(data) as SourceMapData | IndexMapData;

			if((data as SourceMapData).sources) {
				data = data as SourceMapData;
				const sources = data.sources;
				const content = data.sourcesContent || (data.sourcesContent = []);
				const root = data.sourceRoot || '';

				for(let num = 0; num < sources.length; ++num) {
					const key = URL.resolve(url, root + sources[num]);
					const spec = keyTbl ? keyTbl[key] : emptySpec;

					content[num] = spec.code || content[num] || null;
					sources[num] = spec.key || key;
				}

				// Inline source maps always apply to the file they're in anyway.
				delete data.file;
				this.json = data;
			} else if((data as IndexMapData).sections) {
				this.json = data;
			}
		}
	}

	encodeURL() {
		if(!this.encoded) {
			this.encoded = (
				'data:application/json;charset=utf-8;base64,' +
				encode64(JSON.stringify(this.json))
			);
		}

		return this.encoded;
	}

	/** Base64-encoded data with MIME type prefix. */
	encoded?: string;
	/** Source or index map contents in JSON format. */
	json?: SourceMapData | IndexMapData;

}
