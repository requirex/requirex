import { keys, slice, indexOf } from '../platform/util';
import { PluginClass } from '../Plugin';
import { Task } from './WorkerManager';
import { Channel, MessageKind, WorkerGlobal } from './Channel';

/** Main entry point for processing incoming messages on the Web Worker side.
  * Routes them to a correct handler class based on a route string matching an
  * arbitrary unique identifier from a static property of the worker class. */

export class WorkerCallee {

	constructor(ref: WorkerGlobal) {
		this.channel = new Channel(ref, (data: any) => {
			const task: Task = data;
			const worker = this.routeTbl[task.route];

			return worker[task.method].apply(worker, task.args) as Promise<any>;
		});
	}

	makeProxy<PluginType>(Plugin: PluginClass<PluginType>) {
		const channel = this.channel;
		const proto = Plugin.prototype;
		const { workerAPI } = Plugin;

		if(!workerAPI) return;

		for(let method of keys(proto)) {
			const func = proto[method];

			if(typeof func == 'function' && indexOf(func, workerAPI) >= 0) {
				proto[method] = function() {
					const args = slice.call(arguments);

					return channel.post(MessageKind.RPC, { route: proto.id, method, args });
				};
			}
		}
	}

	/** Register a worker class with methods callable based on incoming messages. */

	register<WorkerType>(
		route: string,
		worker: WorkerType
	) {
		this.routeTbl[route] = worker;
	}

	channel: Channel;

	/** Table mapping unique route identifiers to worker classes using them. */
	routeTbl: { [route: string]: any } = {};

}
