import { encode64 } from '@lib/base64';
import { keys, slice, stringify } from '../platform/util';
import { PluginClass, LoaderPlugin } from '../Plugin';
import { Loader } from '../Loader';
import { Channel, MessageKind } from './Channel';

/** Wraps a Web Worker method call and handlers for finalizing a promise
  * returned to the original caller. */

export interface Task {

	/** Arbitrary string identifying a class on the Web Worker side for
	  * calling a method of the correct class. */
	route: string;

	/** Name of method to call. Even if code is mangled, same code runs in UI
	  * thread and workers so the name will still match. */
	method: string;

	/** Arguments passed to the method. Must be serializable to JSON. */
	args: any[];

	/** Called when worker thread sends a message reporting success and results. */
	resolve?: (result: any) => void;

	/** Called when worker thread sends an error message. */
	reject?: (err: any) => void;

}

/** Manage pools of Web Workers.
  * 
  * Create an instance using the static createManager method.
  *
  * Mostly used by the pluginFactory which silently wraps worker class methods
  * into calls of the rpc method defined below.
  *
  * The pluginFactory reads an (optional) name of the pool where a method should
  * get executed, from an affinity property attached to the method in the class
  * prototype. */

export class WorkerManager {

	/** Create a new worker manager instance.
	  *
	  * @param loaderAddress URL of script to execute in workers. If undefined,
	  * try to get the URL of the current script (containing this class).
	  *
	  * @return Worker manager instance or undefined if no URL was given or
	  * detected. */

	static createManager(loader: Loader, loaderAddress?: string) {
		const script = document.currentScript as HTMLScriptElement | null;

		if(script && typeof script == 'object' && script.src) {
			loaderAddress = script.src;
		} else {
			try {
				// For IE, throw an error to get the script address from a stack trace.
				throw (new Error());
			} catch(err) {
				/** Origin from a URL (protocol, possible server with port,
				  * possible path with no colons). */
				var match = err.stack.match(/[A-Za-z]+:\/+[^/ \t\n]*[^: \t\n]+/);
				if(match) loaderAddress = match[0];
			}
		}

		if(loaderAddress) return new WorkerManager(loader, loaderAddress);
	}

	private constructor(private loader: Loader, private loaderAddress: string) { }

	/** Create a new Web Worker.
	  * 
	  * @param affinity Name of pool to store the new worker. */

	private createWorker(affinity: string) {
		const group = this.pools[affinity];

		group.workerStack.push(new Channel(
			new Worker(this.workerCode || (this.workerCode = (
				'data:application/javascript;base64,' +
				encode64(
					'importScripts(' + stringify(this.loaderAddress) +
					');System.config({baseURL:' + stringify(
						this.loader.config.baseURL ||
						this.loader.config.libraryBaseKey ||
						this.loaderAddress
					) + '})'
				)
			))),
			(data: any) => {
				const plugin = this.routeTbl[data.route];
				return plugin && plugin[data.method].apply(plugin, data.args);
			},
			group.workerCount++
		));
	}

	/** Schedule a new task or execute it immediately if possible.
	  *
	  * @param affinity Name of pool where a worker finished or new task starts.
	  * @param worker Web Worker that finished its a task and needs more work.
	  * @param task New task to send to a worker or queue for execution. */

	private schedule(affinity: string, channel?: Channel, task?: Task) {
		/** Worker pool (a new one if given name did not exist). */
		const pool = this.pools[affinity] || (this.pools[affinity] = {
			concurrency: 1,
			workerCount: 0,
			workerStack: [],
			taskStack: []
		});

		const { taskStack, workerStack } = pool;

		if(!task && taskStack.length) {
			// If no task was given, maybe one is scheduled and waiting.
			task = taskStack.pop()!;
		}

		if(task) {
			if(!channel) {
				// If no worker was given, look for an idle one or create a new
				// one if concurrency limit has not been reached yet.

				let freeCount = workerStack.length;

				if(!freeCount && pool.workerCount < pool.concurrency) {
					this.createWorker(affinity);
					++freeCount;
				}

				if(freeCount) {
					channel = workerStack.pop()!;
				}
			}

			if(channel) {
				// If there is an available worker and a task for it, send a message
				// for the worker to start executing the method given in the task.

				const { resolve, reject } = task;

				task.resolve = void 0;
				task.reject = void 0;

				// If an argument is an array with a special property "threads",
				// slice away all initial elements already passed to the same thread.
				// The threads property is used to track previous cumulative array
				// lengths passed to each worker thread, as an optimization to reduce
				// data transferred in messages.

				for(let i = 0; i < task.args.length; ++i) {
					const arg = task.args[i];
					const threads: number[] | false = arg instanceof Array && (arg as any).threads;

					if(threads) {
						const progress = threads[channel.num!];
						threads[channel.num!] = arg.length;
						if(progress) task.args[i] = arg.slice(progress);
					}
				}

				channel.post(MessageKind.RPC, task, (err, data?) => {
					this.schedule(affinity, channel);

					if(err && reject) {
						reject(err);
					} else if(data !== void 0 && resolve) {
						resolve(data);
					}
				});
			} else {
				// If there is a task but no worker, add it on the waiting list.
				taskStack.push(task);
			}
		} else if(channel) {
			// If there is a worker but no task, add the worker to list of idle ones.
			workerStack.push(channel);
		}
	}

	/** Send a message to a Web Worker telling it to call a method and send a
	  * message back with results.
	  *
	  * Wraps the method call into a task object, schedules it for running
	  * in a worker and returns a promise for the result.
	  *
	  * @param route Unique identifier of the worker class.
	  * @param method Name of method to call.
	  * @param args Arguments passed to the method. Must be serializable to JSON.
	  * @param affinity Name of worker pool to use.
	  *
	  * @return Promise for the method call result resolving after the
	  * Web Worker finishes executing it (or rejected on error). */

	rpc(route: string, method: string, args: any[], affinity?: string) {
		return new Promise((resolve, reject) => {
			this.schedule(affinity || 'default', void 0, { route, method, args, resolve, reject });
		});
	}

	/** Set up an RPC proxy passing method calls to workers.
	  *
	  * @param proto Class prototype with methods to proxy.
	  * @param route Unique identifier of the worker class.
	  *
	  * @return Object with proxies calling the corresponding method in a worker. */

	makeProxy(proto: any, route: string) {
		const manager = this;
		const proxy: any = {};

		for(let method of keys(proto)) {
			if(typeof proto[method] == 'function') {
				proxy[method] = function() {
					return manager.rpc(
						route,
						method,
						slice.call(arguments),
						proto[method].affinity
					);
				};
			}
		}

		return proxy;
	}

	register<PluginType extends LoaderPlugin>(
		Plugin: PluginClass<PluginType>,
		pluginInstance: PluginType
	) {
		if(Plugin.workerAPI) {
			this.routeTbl[pluginInstance.id!] = pluginInstance;
		}
	}

	/** Table mapping unique route identifiers to plugin classes using them. */
	private routeTbl: { [route: string]: any } = {};

	/** Pools for allocating workers and listing tasks (method calls) waiting
	  * for execution. Most tasks can run in the default pool.
	  *
	  * Other pools are useful for specific methods requiring custom permanent
	  * resources unnecessary for most methods. */

	private pools: {
		[name: string]: {
			/** Number of concurrent workers to create in this pool. */
			concurrency: number,

			/** Number of workers created so far. */
			workerCount: number,

			/** Stack of workers sitting idle. */
			workerStack: Channel[]

			/** Stack of scheduled method calls waiting for an available worker. */
			taskStack: Task[];
		}
	} = ({
		default: {
			concurrency: 4,
			workerCount: 0,
			workerStack: [],
			taskStack: []
		}
	});

	private workerCode?: string;

}
