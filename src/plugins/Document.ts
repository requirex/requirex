import { Record } from '../Record';
import { ChangeSet } from '../parser/ChangeSet';
import { features } from '../platform/features';
import { globalEnv, globalEval } from '../platform/global';
import { location, origin, getTags } from '../platform/browser';
import { assign, assignReversible, emptyPromise } from '../platform/util';
import { LoaderPlugin, pluginFactory } from '../Plugin';
import { Loader } from '../Loader';

interface TreeItem<Type> extends Array<Node | TreeItem<Type>> {

	/** Root node of this branch.
	  * All other array items are child branches. */
	[0]: Node;

	/** Named property holding custom data. */
	data?: Type;

}

/** Node tree emit state stack item.
  *
  * - Branch root.
  * - number of direct children emitted so far.
  * - closing tag to emit after all children. */

type EmitFrame<Type> = [TreeItem<Type>, number, string?];

/** Enum members of Node as a const enum to save space. See:
  * https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType */

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

/** Store paths to specific nodes in a document and emit the entire document
  * as HTML while tracking the location of or transforming those nodes. */

class NodeTree<Type> {

	/** @param node Any node from the document that this tree should represent
	  * (used to find the document root node). */

	constructor(node: Node) {
		let root = node;

		while((node = node.parentNode as Node)) {
			root = node;
		}

		this.root = [root];
	}

	/** Mark a DOM node in the tree and attach some arbitrary data
	  * without writing to the node object itself. */

	mark(node: Node, data: Type) {
		const stack = [node];
		let item = this.root;

		// Prepare to traverse nodes from document root to marked node.
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

	/** Emit DOM tree as a string, but call a handler function to transform
	  * marked nodes and pass any attached data. */

	emit(emitData: (data: Type, offset: number, open: string, close: string) => string) {
		let result = '';
		let stack: EmitFrame<Type>[] = [[this.root, 0]];
		let frame: EmitFrame<Type> | undefined;
		let chunk: string | null;

		while((frame = stack.pop())) {
			let [item, childNum, closeTag] = frame;
			let node = item[0];
			let children = node.childNodes;
			let count = children.length;

			while(childNum < count) {
				chunk = '';
				node = children[childNum++];

				switch(node.nodeType) {
					case NodeType.ELEMENT_NODE:

						const element = node as HTMLElement;
						let num = item.length;

						while(--num && node != (item[num] as TreeItem<Type>)[0]) { }

						if(!num) {
							chunk = element.outerHTML;
						} else {
							chunk = (element.cloneNode(false) as HTMLElement).outerHTML;

							const split = chunk.lastIndexOf('></') + 1 || chunk.length;
							const open = chunk.substr(0, split);
							const close = chunk.substr(split);
							const branch = item[num] as TreeItem<Type>;

							if(branch.data) {
								chunk = emitData(branch.data, result.length, open, close);
							} else {
								chunk = open;

								// Continue from next sibling after emitting subtree.
								stack.push([item, childNum, closeTag]);

								// Emit subtree next.
								item = branch;
								childNum = 0;
								closeTag = close;

								node = item[0];
								children = node.childNodes;
								count = children.length;
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

				result += chunk;
			}

			result += closeTag || '';
		}

		return result;
	}

	root: TreeItem<Type>;

}

const reType = /^x-req[^-]*(-([^-]+)-)?/

export interface DocumentConfig {

	stage?: string;

}

/** Document element loader plugin. */

export class DocumentPlugin implements LoaderPlugin {

	constructor(private loader: Loader, public config?: DocumentConfig) {
		this.doc = features.doc;

		if(config) {
			let stage = config.stage;

			if(stage == 'auto' && location) {
				const host = location.hostname;
				const match = location.search.match(/[?&]stage=([^&=]+)(&|$)/);

				if(match) {
					stage = match[1];
				} else {
					stage = (host == 'localhost' || host == '127.0.0.1' || host == '::1' || !host ?
						'dev' : 'prod'
					);
				}
			}

			this.stage = stage;
		}
	}

	fetchRecord(record: Record) {
		const doc = this.doc;

		if(location) record.resolvedKey = origin + location.pathname + location.search;

		/** Wait until the page loads. */
		const domReady = !doc ? emptyPromise : new Promise((resolve: () => void, reject: (err: any) => void) => {
			const complete = 'complete';
			let almostReady = complete;
			let resolved = false;

			function check() {
				const ready = doc!.readyState;

				if(!resolved && (!ready || ready == complete || ready == almostReady)) {
					resolve();
					resolved = true;
				}

				return resolved;
			}

			if(check()) {
				// Not ready yet, keep waiting...
			} else if(doc.addEventListener) {
				// Disregard initial "interactive" state to work around browser issues.
				almostReady = 'interactive';
				doc.addEventListener('DOMContentLoaded', check);
				window.addEventListener('load', check);
			} else if((doc as any).attachEvent) {
				// Support ancient IE.
				(doc as any).attachEvent('onreadystatechange', check);
			} else {
				reject(new Error('Unsupported browser'));
			}
		});

		return domReady.then(() => {
			const tree = new NodeTree<HTMLScriptElement>(doc!);
			let chunkCount = 0;

			for(let element of [].slice.call(!getTags ? [] : getTags('script')) as HTMLScriptElement[]) {
				const type = element.type;
				const match = type && type.match(reType);

				if(match && (!match[2] || match[2] == this.stage)) {
					// Prepend hyphen to avoid processing the same script twice.
					element.setAttribute('type', '-' + type);

					// Trace script element location for source map.
					tree.mark(element, element);

					++chunkCount;
				}
			}

			if(!chunkCount) return record;

			/** Start offset of HTML content between found script elements. */
			let prevOffset = 0;
			/** Replacement string for previous HTML content. */
			let prevCode = '';
			const changeSet = new ChangeSet();

			const original = tree.emit((element: HTMLScriptElement, offset: number, open: string, close: string) => {
				let result: string;

				if(element.src) {
					// External script. Emit open and close tag in source map.
					result = open + close;
					changeSet.add(prevOffset, offset, prevCode);

					// When executed, replace with a require() statement.
					prevOffset = offset;
					prevCode = 'require("' + element.src + '")';
				} else {
					// Inline script. Emit element with contents in source map.
					const code = element.text;
					result = open + code + close;
					offset += open.length;
					changeSet.add(prevOffset, offset, prevCode);

					// Leave text content as is when executing the code.
					prevOffset = offset + code.length;
					prevCode = '';
				}

				return result;
			});

			changeSet.add(prevOffset, original.length, prevCode);

			record.compiled = () => {
				// Copy the record's global variables to the global environment.
				const oldVars = assignReversible(globalEnv, record.argTbl);

				// Inline scripts get executed in the global environment.
				globalEval(
					(record.sourceCode || '') +
					record.getPragma()
				);

				// Restore global environment.
				assign(globalEnv, oldVars);
			};

			// Comment out all HTML code. This preserves source map offsets
			// between original HTML and transpiled JavaScript code.

			record.sourceCode = changeSet.patchCode(original);
			record.sourceOriginal = original;

			record.addPlugin(this.loader.getDefaultPlugin(), true);

			return record;
		})
	}

	doc?: Document;

	id?: string;

	stage?: string;

}

export const Document = pluginFactory('document', DocumentPlugin);
