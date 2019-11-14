import { URL } from '../URL';
import { Record, DepRef } from '../Record';
import { Loader, LoaderPlugin } from '../Loader';
import { ChangeSet } from '../ChangeSet';
import { origin, getTags, globalEnv, assign, assignReversible } from '../platform';

interface TreeItem<Type> extends Array<Node | TreeItem<Type>> {
	/** Root node of this branch.
	  * All other array items are child branches. */
	[0]: Node;
	data?: Type;
}

export const enum NodeType {
	ELEMENT_NODE = 1,
	TEXT_NODE = 3,
	CDATA_SECTION_NODE = 4,
	PROCESSING_INSTRUCTION_NODE = 7,
	COMMENT_NODE = 8,
	DOCUMENT_NODE = 9,
	DOCUMENT_TYPE_NODE = 10,
	DOCUMENT_FRAGMENT_NODE = 11
}

const trackResult: [number, number] = [0, 0];

function trackPos(html: string | null, row: number, col: number) {
	let rowOffset = 0;
	let pos = 0;

	html = html || '';

	while((pos = html.indexOf('\n', pos) + 1)) {
		++row;
		col = 0;
		rowOffset = pos;
	}

	col += html.length - rowOffset;

	trackResult[0] = row;
	trackResult[1] = col;

	return html;
}

/** Store paths to specific nodes in a document and emit the entire document
  * as HTML while tracking the location of or transforming those nodes. */

class NodeTree<Type> {

	/** @param node Any node from the document this tree should represent. */

	constructor(node: Node) {
		let root: Node;

		do {
			root = node;
		} while((node = node.parentNode as Node));

		this.root = [root];
	}

	add(node: Node, data: Type) {
		const stack = [node];
		let item = this.root;

		while((node = node.parentNode as Node)) {
			stack.push(node);
		}

		// Ensure node is in the same DOM tree (= document).
		if(stack.pop() != item[0]) return;

		while((node = stack.pop()!)) {
			// Check if node is an already found child.
			let num = item.length;
			while(--num && node != (item[num] as TreeItem<Type>)[0]) { }

			if(!num) {
				// Append previously missing child.
				num = item.length;
				item[num] = [node];
			}

			item = item[num] as TreeItem<Type>;
		}

		item.data = data;
	}

	emit(emitData: (data: Type, row: number, col: number) => string) {
		let result = '';
		let stack = [this.root, 0, ''];
		let stackPos = 6;
		let html: string;
		let row = 0;
		let col = 0;
		let chunk: string | null;

		while(stackPos -= 3) {
			const item = stack[stackPos - 3] as TreeItem<Type>;
			let node = item[0];
			const children = node.childNodes;
			const count = children.length;

			for(let childNum = stack[stackPos - 2] as number; childNum < count; ++childNum) {
				chunk = '';
				node = children[childNum];

				switch(node.nodeType) {
					case NodeType.ELEMENT_NODE:

						const element = node as HTMLElement;
						let num = item.length;

						while(--num && node != (item[num] as TreeItem<Type>)[0]) { }

						if(!num) {
							chunk = element.outerHTML;
						} else {
							const branch = item[num] as TreeItem<Type>;
							html = (element.cloneNode(false) as HTMLElement).outerHTML;
							const split = html.lastIndexOf('></') + 1 || html.length;
							const open = html.substr(0, split);
							const close = html.substr(split);

							if(branch.data) {
								chunk = open + emitData(branch.data, row, col + open.length) + close;
							} else {
								chunk = open;

								stack[stackPos - 2] = childNum + 1;

								stack[stackPos] = branch;
								stack[stackPos + 1] = 0;
								stack[stackPos + 2] = close;
								stackPos += 6;
								childNum = count + 1;
							}
						}
						break;

					case NodeType.TEXT_NODE:

						chunk = node.nodeValue;
						break;

					case NodeType.COMMENT_NODE:

						chunk = '<!--' + node.nodeValue + '-->';
						break;

					case NodeType.DOCUMENT_TYPE_NODE:

						// Emit doctype and a line break. Seems that actual
						// whitespace before root element cannot be recovered?
						if(typeof XMLSerializer == 'function') {
							chunk = new XMLSerializer().serializeToString(node) + '\n';
						}
						break;

				}

				result += trackPos(chunk, row, col);
				[row, col] = trackResult;
			}

			chunk = stack[stackPos - 1] as string;
			if(chunk) result += trackPos(chunk, row, col);
		}

		return result;
	}

	root: TreeItem<Type>;

}

/** Document element loader plugin. */

export class Document implements LoaderPlugin {

	constructor(private loader: Loader) { }

	resolveSync(key: string, baseKey?: string) {
		return baseKey || origin;
	}

	fetchRecord() {
		return new Promise<void>((resolve: () => void, reject: (err: any) => void) => {
			let resolved = false;
			// Disregard initial "interactive" state to work around browser issues.
			let almostReady = 'complete';

			function check() {
				const ready = document.readyState;

				if(!resolved && (!ready || ready == 'complete' || ready == almostReady)) {
					resolve();
					resolved = true;
				}

				return resolved;
			}

			if(check()) return;

			if(document.addEventListener) {
				almostReady = 'interactive';
				document.addEventListener('DOMContentLoaded', check);
				window.addEventListener('load', check);
			} else if((document as any).attachEvent) {
				// Support ancient IE.
				(document as any).attachEvent('onreadystatechange', check);
			} else {
				reject(new Error('Unsupported browser'));
			}
		});
	}

	discover(record: Record) {
		const tree = new NodeTree<DepRef>(document);
		const key = origin + window.location.pathname + window.location.search;
		let inlineCount = 0;

		for(let element of [].slice.call(getTags && getTags('script')) as HTMLScriptElement[]) {
			const type = element.type;
			if(type && type.substr(0, 5) == 'x-req') {
				// Prepend hyphen to avoid processing the same script twice.
				element.setAttribute('type', '-' + type);

				if(element.src) {
					// External script.
					record.addDep(URL.resolve(key, element.src));
				} else {
					// Inline script.
					++inlineCount;

					const code = element.text;
					const inline: DepRef = {
						format: 'js',
						sourceKey: URL.resolve(key, 'Script%20' + inlineCount),
						sourceCode: code,
						// Inject transpiled inline scripts in order without
						// a wrapper function to ensure they get evaluated
						// in the correct environment.
						eval: (record: Record) => {
							const oldVars = assignReversible(globalEnv, record.argTbl);

							const script = document.createElement('script');
							const content = document.createTextNode(record.wrap(true, true));

							script.appendChild(content);
							// Replacing the script element should immediately
							// run the code synchronously.
							element.parentNode!.replaceChild(script, element);

							assign(globalEnv, oldVars);
						}
					};

					// Trace script element location for source map.
					tree.add(element, inline);

					record.addDep(URL.resolve(key, 'Inline%20' + inlineCount), inline);
				}
			}
		}

		if(inlineCount) {
			const inlineList: DepRef[] = [];
			const original = tree.emit((inline: DepRef, row: number, col: number) => {
				let code = inline.sourceCode || '';
				let offset = code.match(/^\s*/)![0].length;

				trackPos(code.substr(0, offset), row, col);
				[row, col] = trackResult;

				inline.changeSet = new ChangeSet();
				inline.changeSet.add({
					startOffset: 0,
					startRow: 0,
					startCol: 0,
					endOffset: 0,
					endRow: row,
					endCol: col
				}, '');

				inline.sourceCode = code.substr(offset);
				inlineList.push(inline);

				return code;
			});

			for(let inline of inlineList) {
				inline.sourceOriginal = original;
			}
		}
	}

	instantiate(record: Record) {
		// Execute scripts in order of appearance.
		for(let key of record.depList) {
			const dep = record.depTbl[key]!;
			if(dep.record) this.loader.instantiate(dep.record);
		}
	}

}
