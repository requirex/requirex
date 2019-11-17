import { URL } from './URL';
import { encode64 } from '@lib/base64';

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

export interface IndexMapData {
	version: number;
	file?: string;
	sections: {
		offset: { line: number, column: number },
		url?: string,
		map?: SourceMapData
	}[]
}

export class SourceMap {

	constructor(url: string, data?: string | SourceMapData | IndexMapData) {
		if(!data) {
			this.encoded = url;
		} else {
			if(typeof data == 'string') data = JSON.parse(data) as SourceMapData | IndexMapData;

			if((data as SourceMapData).sources) {
				data = data as SourceMapData;
				const sources = data.sources;
				// const content = data.sourcesContent || (data.sourcesContent = []);
				const root = data.sourceRoot || '';

				for(let num = 0; num < sources.length; ++num) {
					const key = URL.resolve(url, root + sources[num]);
					/* const spec = keyTbl ? keyTbl[key] : emptySpec;

					sources[num] = spec.key || key;
					content[num] = spec.code || content[num] || null; */
					sources[num] = key;
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

	encoded?: string;
	json?: SourceMapData | IndexMapData;

}
