export const enum MessageKind {
	REPLY,
	RPC
}

export type MessageHandler = (err: any, data?: any) => any;

export interface Message {
	kind: MessageKind;
	slot: number;
	data?: any;
	err?: any;
}

export interface WorkerGlobal {
	onmessage?: (this: WorkerGlobal, event: MessageEvent) => any;
	postMessage(message: any, options?: any): void;
}

export class Channel {

	constructor(private ref: Worker | WorkerGlobal, private handler?: (data: any) => any, public num?: number) {
		if(ref) ref.onmessage = (event) => this.onmessage(event);
	}

	private onmessage(event: MessageEvent) {
		const { kind, slot, data, err } = (event.data as Message) || {};

		if(kind == MessageKind.REPLY) {
			const handler = this.slots[slot];

			if(handler) {
				handler(err, data);
				this.slots[slot] = null;
				this.freeSlots.push(slot);
			}
		} else if(this.handler) {
			const msg: Message = { kind: MessageKind.REPLY, slot };

			Promise.resolve(this.handler(data)).then(
				(data) => msg.data = data,
				(err: Error) => msg.err = '' + err
			).then(() => this.ref.postMessage(msg));
		}
	}

	post(kind: MessageKind, data: any): Promise<any>;
	post(kind: MessageKind, data: any, handler?: MessageHandler): void;
	post(kind: MessageKind, data: any, handler?: MessageHandler) {
		let result: Promise<any> | undefined;

		if(!handler) {
			result = new Promise((resolve, reject) => {
				handler = (err, data) => err ? reject(err) : resolve(data)
			});
		}

		const slot = this.freeSlots.pop() || this.slots.length;
		this.slots[slot] = handler!;

		this.ref.postMessage({ kind, slot, data });

		return result;
	}

	/** Handlers for received replies reporting a result or error. */
	private slots: (MessageHandler | null)[] = [null];
	private freeSlots: number[] = [];

}
