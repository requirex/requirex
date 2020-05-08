import * as path from 'path';
import * as fs from 'fs';

import { decodeVLQ } from '@lib/base64-vlq';
import { fetch, URL } from '..';

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

const enum EventKind {
	START,
	END
}

/** Source code range. */

interface Range {

	/** Starting byte offset. */
	start: number;

	/** Ending byte offset. */
	end: number;

}

/** Range of equivalent code from a source map. */

interface MapRange extends Range {

	/** Corresponding starting byte offset in generated code. */
	genStart: number;

	/** Corresponding ending byte offset in generated code. */
	genEnd: number;

}

/** Range of code representing a block from a code coverage report. */

interface CoverageRange extends Range {

	functionName: string;

	/** Number of times the code block was executed. */
	count: number;

	/** Byte length, used for sorting. */
	len?: number;

	/** Sequential number, used as a tie breaker for sorting. */
	id?: number;

}

/** Information for a single source code file found in a code coverage report. */

interface CoverageFile {

	/** Fully resolved URL address. */
	resolvedKey: string;

	/** Source code that was actually executed. */
	code: string;

	/** Coverage information for individual code blocks. */
	ranges: CoverageRange[];

}

/** Coverage range starting or ending. Nested ranges are easier to handle by
  * sorting events for their endpoints and pushing / popping to a stack. */

interface CoverageEvent {

	/** Range start or end. */
	kind: EventKind;

	/** Byte offset in code. */
	pos: number;

	/** Range starting or ending. */
	range: CoverageRange;

}

/** Resolve original source code addresses from source map. */

function getMapSources(key: string, data: SourceMapData) {
	/** Relative path prefix shared by all references. */
	const root = data.sourceRoot || ''
	let sources: string[] = [];

	for(let path of data.sources) {
		sources.push(URL.resolve(key, root + path));
	}

	return sources;
}

/** Parse source map returning ranges of code with matching offsets to
  * original and generated code. */

function parseMap(
	data: SourceMapData,
	generated: string,
	original: string
) {
	if(data.version != 3) throw(new Error('Unsupported source map version: ' + data.version));

	/** Result to return: parsed ranges. */
	const ranges: MapRange[] = [];

	/** Base64 VLQ encoded source map ranges grouped by commas and semicolons. */
	const map = data.mappings;
	const mapLen = map.length;

	/** Buffer for decoding Base64 VLQ fields. */
	const buf: number[] = [];
	/** Number of fields found in Base64 VLQ chunk. */
	let count: number;

	/** Semicolon-delimited groups represent lines in generated code. */
	let groupPos = 0;
	/** Offset of next semicolon or end of data. */
	let groupEnd = 0;

	/** Comma-separated segments represent column ranges in generated code. */
	let segPos = 0;
	/** Offset of next comma, semicolon or end of data, whichever comes first. */
	let segEnd: number;

	// let srcFile = 0;

	/** Offset in original code. Row numbers are not tracked, instead offset
	  * skips between line breaks as needed. */
	let srcOffset = 0;

	/** Next original code offset to jump into. */
	let srcNext: number;

	/** Column number in original code. Only needed for moving between lines
	  * without changing columns. NOTE: Tab size is 1. */
	let srcCol = 0;

	/** Offset in generated code. Maniplated directly without tracking rows or
	  * columns. */
	let genOffset = 0;

	while(groupEnd < mapLen) {
		groupEnd = (map.indexOf(';', groupPos) + 1 || mapLen + 1);

		segPos = groupPos;

		do {
			segEnd = (map.indexOf(',', segPos) + 1 || groupEnd);
			if(segEnd > groupEnd) segEnd = groupEnd;

			// Decode Base64 VLQ fields with line and column numbers for a
			// single equivalent position in original and generated code.
			count = decodeVLQ(map, buf, 0, segPos, segEnd - 1);

			// srcFile += +(count > 1) && buf[1];

			srcNext = srcOffset;

			if(count > 2) {
				// Move between lines in original code.
				let srcRowDelta = buf[2];

				if(srcRowDelta) {
					if(srcRowDelta > 0) {
						while(srcRowDelta--) {
							// Skip to beginning of next line.
							srcNext = original.indexOf('\n', srcNext) + 1;
						}
					} else {
						// Iterate one extra time to skip to beginning of
						// current line.
						--srcRowDelta;

						while(srcRowDelta++) {
							// Skip to end of previous line.
							srcNext = original.lastIndexOf('\n', srcNext - 1);
						}

						// Move to beginning of next line.
						++srcNext;
					}

					// Return to column offset before line change. This may
					// accidentally skip more line breaks, but applying column
					// delta will undo the problem.
					srcNext += srcCol;
				}
			}

			if(count > 3) {
				// Move between columns in original code.
				const srcColDelta = buf[3];

				srcCol += srcColDelta;
				srcNext += srcColDelta;
			}

			// Detect a range of equivalent code if column in generated code
			// and position in original code increase simultaneously.
			// Other offset changes likely represent skipped code.

			if(count > 0 && buf[0] > 0 && srcNext > srcOffset) {
				ranges.push({
					start: srcOffset,
					end: srcNext,
					genStart: genOffset,
					genEnd: genOffset + buf[0]
				});
			}

			if(count > 0) {
				// Move between columns in generated code.
				// Generated code line never changes within a single range.
				genOffset += buf[0];
			}

			// Apply changes to position in original code.
			srcOffset = srcNext;

			// Move to next Base64 VLQ -encoded chunk representing the same
			// generated code line.
			segPos = segEnd;
		} while(segEnd < groupEnd);

		// Move to next line in the generated code.
		genOffset = generated.indexOf('\n', genOffset) + 1;
		// Move to next chunk representing the next line.
		groupPos = groupEnd;
	}

	return ranges;
}

/** Truncate overlapping original code ranges in source map. */

function removeOverlap(mapRanges: MapRange[]) {
	let prev: MapRange | undefined;

	mapRanges.sort((a, b) => a.start - b.start || a.end - b.end);

	for(let range of mapRanges) {
		if(prev && prev.end > range.start) prev.end = range.start;

		prev = range;
	}

	return mapRanges;
}

/** Transform code coverage ranges according to source map ranges. */

function applyMap(events: CoverageEvent[], mapRanges: MapRange[]): CoverageRange[] {
	const ranges: CoverageRange[] = [];
	const stack: CoverageRange[] = [];
	let range: CoverageRange | undefined = events[0].range;
	let eventNum = 0;

	mapRanges.sort((a, b) => a.genStart - b.genStart || a.genEnd - b.genEnd);

	for(let mapRange of mapRanges) {
		let event: CoverageEvent;
		let pos = mapRange.start;

		while(eventNum < events.length) {
			event = events[eventNum];

			if(event.pos >= mapRange.genStart) {
				let p = event.pos;

				if(range && range.start < mapRange.genEnd && range.end > mapRange.genStart) {
					if(
						p >= mapRange.genEnd &&
						p - mapRange.genStart + mapRange.start < mapRange.end
					) {
						p = mapRange.end - mapRange.start + mapRange.genStart;
					}
					ranges.push({
						functionName: range.functionName,
						start: Math.max(range.start - mapRange.genStart + mapRange.start, pos),
						end: Math.min(p - mapRange.genStart + mapRange.start, mapRange.end),
						count: range.count
					});
				}

				if(
					p > mapRange.genEnd ||
					(p == mapRange.genEnd && event.kind == EventKind.END)
				) break;

				pos = p - mapRange.genStart + mapRange.start;
			}

			if(event.kind == EventKind.START) {
				range = event.range;
				stack.push(range);
			} else {
				stack.pop();
				range = stack[stack.length - 1];
			}

			++eventNum;
		}

		if(range && range.start < mapRange.genEnd && range.end > mapRange.genStart) {
			let p = range.end;

			if(
				p >= mapRange.genEnd &&
				p - mapRange.genStart + mapRange.start < mapRange.end
			) {
				p = mapRange.end - mapRange.start + mapRange.genStart;
			}

			ranges.push({
				functionName: range.functionName,
				start: Math.max(range.start - mapRange.genStart + mapRange.start, pos),
				end: Math.min(p - mapRange.genStart + mapRange.start, mapRange.end),
				count: range.count
			});
		}
	}

	/* return mapRanges.map((range) => ({
		functionName: '',
		start: range.start,
		end: range.end,
		count: 1
	})); */
	return ranges;
}

/** Extract URL from last source map pragma and resolve it. */

function locateMap(key: string, code: string) {
	let match: RegExpExecArray | null;
	let mapKey: string | undefined;
	const re = /\/\/[#@] *sourceMappingURL=([^\r\n]+)/g;

	while((match = re.exec(code))) {
		mapKey = match[1];
	}

	return mapKey && URL.resolve(key, mapKey);
}

function getEvents(ranges: CoverageRange[]) {
	const events: CoverageEvent[] = [];
	let id = 0;

	for(let range of ranges) {
		range.len = range.end - range.start;

		if(range.len) {
			range.id = id++;
			events.push({ kind: EventKind.START, pos: range.start, range });
			events.push({ kind: EventKind.END, pos: range.end, range });
		}
	}

	// Sort range start and end events so that nested ranges are
	// pushed and popped in the correct order.

	return events.sort((a, b) =>
		// First order events by character position.
		a.pos - b.pos ||
		// When positions match, handle end events before start events.
		b.kind - a.kind ||
		(a.kind == EventKind.START ?
			// For start events, push longer or less visited ranges first.
			(b.range.len! - a.range.len! || a.range.count - b.range.count || a.range.id - b.range.id) :
			// For end events, pop shorter or more visited ranges first.
			(a.range.len! - b.range.len! || b.range.count - a.range.count || b.range.id - a.range.id)
		)
	);
}

function analyzeCode(resolvedKey: string, code: string, ranges: CoverageRange[]) {
	const mapKey = locateMap(resolvedKey, code);

	const file: CoverageFile = { resolvedKey, code, ranges };
	let mapped: Promise<CoverageFile>;

	if(!mapKey) {
		mapped = Promise.resolve(file);
	} else {
		mapped = fetch(mapKey).then(
			(res) => res.text()
		).then((data: string) => {
			const map = JSON.parse(data);
			const source = getMapSources(mapKey!, map)[0];

			return fetch(source).then(
				(res) => res.text()
			).then((original) => {
				const mapRanges = removeOverlap(parseMap(
					map,
					code,
					original
				));

				file.code = original;
				file.ranges = applyMap(getEvents(file.ranges), mapRanges);

				return file;
			});
		})
	}

	return mapped.then(() => {
		let pos = 0;
		let output = '';

		const stack: CoverageRange[] = [];

		const red = '\x1b[1;31m';
		const green = '\x1b[0;32m';
		const reset = '\x1b[0m';

		// console.log(file.ranges);

		for(let event of getEvents(file.ranges)) {
			if(event.kind == EventKind.START) {
				stack.push(event.range);
			} else {
				if(stack[stack.length - 1] == event.range) {
					stack.pop();
				} else {
					console.trace('IMPOSSIBLE', pos, resolvedKey);
					process.exit(1);
				}
			}

			const visited = stack.length && stack[stack.length - 1].count > 0;

			output += (
				file.code.substr(pos, event.pos - pos) +
				(!stack.length ? reset : (visited ? green : red))
				// '\x1b[0;3' + (1 + ~~(Math.random() * 8)) + 'm'
			);

			pos = event.pos;
		}

		output += file.code.substr(pos);
		output += reset;

		if(resolvedKey.indexOf('/test/') < 0) {
			process.stdout.write(resolvedKey + '\n\n' + output + '\n');
		}
	});
}

const coveragePath = path.resolve(process.cwd(), 'coverage');

new Promise((resolve: (names: string[]) => void, reject) => fs.readdir(
	coveragePath,
	(err, names) => err ? reject(err) : resolve(names)
)).then((names) => {
	let latestStamp = 0;
	let latestIndex = 0;
	let latestName: string | undefined;

	for(let name of names) {
		const match = name.match(/^coverage-[0-9]+-([0-9]+)-([0-9]+).json$/);

		if(match) {
			const stamp = +match[1];
			const index = +match[2];

			if(stamp > latestStamp || (stamp == latestStamp && index > latestIndex)) {
				latestStamp = stamp;
				latestIndex = index;
				latestName = name;
			}
		}
	}

	if(!latestName) throw(new Error('Coverage file not found'));

	return new Promise((resolve: (data: string) => void, reject) =>
		fs.readFile(
			path.resolve(coveragePath, latestName!),
			'utf-8',
			(err, data) => err ? reject(err) : resolve(data)
		)
	);
}).then((data) => {
	const found: Promise<any>[] = [];

	for(let script of JSON.parse(data).result) {
		if(script.url.substr(0, 7) != 'file://' || script.url.indexOf('/node_modules/') >= 0) continue;

		const ranges: CoverageRange[] = [];

		for(let func of script.functions) {
			for(let range of func.ranges) {
				ranges.push({
					functionName: func.functionName,
					count: range.count,
					// Undo 12-byte offset from IIFE wrapper in run.js.
					start: Math.max(0, range.startOffset - 12),
					end: Math.max(0, range.endOffset - 12)
				});
			}
		}

		found.push(
			fetch(script.url).then(
				(res) => res.text()
			).then(
				(data) => analyzeCode(script.url, data, ranges)
			)
		);
	}

	return Promise.all(found);
}).then((fileList) => {
	// console.log(fileList);
});
