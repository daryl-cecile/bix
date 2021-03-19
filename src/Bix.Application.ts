import {EmptyFunctionWithSingleParam, IDisposable} from "./Bix.Utils";
import {Context} from "./Bix.Context";
import {Controller, ControllerKitController, Route, Router} from "./Bix.Router";
import {v4 as uuid} from 'uuid';
import * as http from "http";
import * as path from "path";

import * as ejs from "ejs";

export type AppEnvironments = "production"|"development"|"staging";

export type AppOptions = {
	env?:AppEnvironments,
	cleanupHandler?:Function,
	publicAssetsFolder?:string,
	storageFolder?:string,
	enableCache?:boolean,
	trustProxy?:boolean|number|Function,
	etag?:boolean|string|Function,
	view?:{
		engine?:string,
		viewFolderPath?:string,
		viewFolderName?:string
	},
	subdomainOffset?:number,
	ignoreRouteCase?:boolean,
	disableEvents?:boolean
};

export type AppConstants = {
	maxChunkSizeForETag:number,
	jsonOptions:{
		escape:boolean,
		replacer:(this: any, key: string, value: any) => any,
		spaces:string,
		callbackName:string
	},
	[constantName:string]:any
}

export type AppLevelEvents = {
	"*"?: Array<AppEventHandler>,
	"APP:CREATED" ?: Array<AppEventHandler>
	"APP:STARTING" ?: Array<AppEventHandler>
	"APP:STARTED" ?: Array<AppEventHandler>
	"APP:ENDING" ?: Array<AppEventHandler>
	"APP:ENDED" ?: Array<AppEventHandler>
	"ROUTES:BEFORE_REFRESH" ?: Array<AppEventHandler>
	"ROUTES:AFTER_REFRESH" ?: Array<AppEventHandler>
	"REQUEST:INCOMING" ?: Array<AppEventHandler>
	"REQUEST:NOT_FOUND" ?: Array<AppEventHandler>
	"REQUEST:ERRORED" ?: Array<AppEventHandler>
	"CONTROLLER:REGISTERED" ?: Array<AppEventHandler>
	[customEventName:string] : Array<AppEventHandler>
};

export type AppLevelErrorHandlers = {
	"NOT_FOUND"?: EmptyFunctionWithSingleParam<Context>
	"INTERNAL"?: EmptyFunctionWithSingleParam<Context>
};

export type AppLevelEventNames = Exclude<keyof AppLevelEvents, number>;

export type AppCycleStatus = "STARTED" | "READY" | "ENDED";

export type AppEventDetails =  {
	eventKey: AppLevelEventNames
	arguments: Array<any>
	shouldIgnore: boolean,
	callPosition: number
};

export type AppEventHandler = (details:AppEventDetails)=>void;

export namespace ApplicationError{

	export class AppCycleError extends Error{
		toString(){
			return [
				this.name,
				this.message,
				'',
				this.stack
			].join('\n');
		}
	}

	export class AppContextError extends Error{
		public code:string;

		toString(){
			return [
				this.name + ` [${this.code}]`,
				this.message,
				'',
				this.stack
			].join('\n');
		}
	}

	export class AppRequestError extends Error{
		public status:number;
		public statusCode:number;
		public types:string[];

		toString(){
			return [
				this.name + ` [${this.statusCode} / ${this.status}]`,
				this.message,
				'',
				this.stack,
				'',
				'types: ' + this.types.join(', ')
			].join('\n');
		}
	}

	export class AppRouterError extends Error{
		toString(){
			return [
				this.name,
				this.message,
				'',
				this.stack,
			].join('\n');
		}
	}

	export class AppLifecycleError extends Error{
		toString(){
			return [
				this.name,
				this.message,
				'',
				this.stack
			].join('\n');
		}
	}
}

class AppEventEmitter{
	private _status:AppCycleStatus = "STARTED";
	private readonly handlers:AppLevelEvents = {};
	private readonly isEnabled:boolean = true;

	constructor(enabled:boolean = true) {
		this.isEnabled = enabled;
	}

	get status(){
		return this._status;
	}

	subscribeAll(handler:AppEventHandler){
		if (!this.isEnabled) return;
		return this.subscribe("*", handler);
	}

	subscribe(eventKey:AppLevelEventNames, handler:AppEventHandler){
		if (!this.isEnabled) return;
		let parsedKey = AppEventEmitter.parseEventKey(eventKey);

		// if (parsedKey.wholeEventKey !== "*" && parsedKey.wholeEventKey.indexOf("*") > -1){
		// 	let eventKeyMatches = [];
		// 	if (parsedKey.eventName === "*"){
		// 		eventKeyMatches.push(
		// 			...Object.keys(this.handlers).filter(k => k.startsWith(parsedKey.eventNamespace + ":"))
		// 		);
		// 	}
		// 	if (parsedKey.eventNamespace === "*"){
		// 		eventKeyMatches.push(
		// 			...Object.keys(this.handlers).filter(k => k.endsWith(":" + parsedKey.eventName))
		// 		);
		// 	}
		// 	let unsubscribeHooks = eventKeyMatches.map(eventKey => {
		// 		return this.subscribe(eventKey, handler);
		// 	});
		// 	return {
		// 		unsubscribe: ()=>{
		// 			unsubscribeHooks.forEach(hook => hook.unsubscribe());
		// 		}
		// 	}
		// }

		if (!this.handlers[parsedKey.wholeEventKey]) this.handlers[parsedKey.wholeEventKey] = [];
		this.handlers[parsedKey.wholeEventKey].push(handler);
		return {
			unsubscribe: <Function>this.unsubscribe.bind(this, eventKey, handler)
		};
	}

	unsubscribe(uniqueEventKey:string, exactHandler:AppEventHandler){
		if (!this.isEnabled) return;
		let parsedKey = AppEventEmitter.parseEventKey(uniqueEventKey);
		if (!Array.isArray(this.handlers[parsedKey.wholeEventKey])) return false;
		let i = this.handlers[parsedKey.wholeEventKey].indexOf(exactHandler);
		if (i === -1) return false;
		this.handlers[parsedKey.wholeEventKey].splice(i, 1);
		return true;
	}

	private static parseEventKey(eventKey:string){
		let eKeyNormalized = AppEventEmitter.normalizeEventKey(eventKey);
		let parts = eKeyNormalized.split(":");
		return {
			eventNamespace: parts[0],
			eventName: parts[1] ?? "*",
			wholeEventKey: eKeyNormalized
		}
	}

	private static normalizeEventKey(eventKey:string):string{
		let trimmedEventKey = eventKey.trim()
		if (trimmedEventKey === "*") return trimmedEventKey;
		if (trimmedEventKey.split(":").length !== 2){
			throw new ApplicationError.AppCycleError(`Event key must be properly namespaced. E.g. 'CUSTOM_NS:CLEAR' or 'CONNECTION:NEW', got '${trimmedEventKey}'`);
		}
		return trimmedEventKey
			.replace(/[ ]/gm,"_")
			.replace(/[^a-zA-Z0-9_:*]/gm, "")
			.toUpperCase();
	}

	protected trigger(eventKey:AppLevelEventNames, ...args:Array<any>){
		if (!this.isEnabled || eventKey === "*") return;
		eventKey = AppEventEmitter.normalizeEventKey(eventKey);
		let eventInfo:AppEventDetails = {
			eventKey,
			arguments: args,
			shouldIgnore: false,
			callPosition: 0
		};
		if (Array.isArray(this.handlers["*"])) this.handlers["*"].forEach(handler => {
			handler(eventInfo);
			eventInfo.callPosition ++;
		});
		if (Array.isArray(this.handlers[eventKey])) this.handlers[eventKey].forEach(handler => {
			handler(eventInfo);
			eventInfo.callPosition ++;
		});

		if (eventKey.indexOf("*") === -1){
			let [ns, en] = eventKey.split(":");
			if (Array.isArray(this.handlers[`${ns}:*`])) this.handlers[`${ns}:*`].forEach(handler => {
				handler(eventInfo);
				eventInfo.callPosition ++;
			});
			if (Array.isArray(this.handlers[`*:${en}`])) this.handlers[`*:${en}`].forEach(handler => {
				handler(eventInfo);
				eventInfo.callPosition ++;
			});
		}
	}

	destroy() {
		Object.keys(this.handlers).forEach(eventKey => {
			this.handlers[eventKey] = [];
		});
		this._status = "ENDED";
	}

}

abstract class Application extends AppEventEmitter implements IDisposable{
	public readonly guid = uuid();
	public appConstants:AppConstants;

	public stack:Array<Controller> = [];
	public routeStack:Array<Route> = [];

	private appOptions:AppOptions = {};
	private baseRouter:Router;
	private appErrorHandlers:AppLevelErrorHandlers = {};

	get options():AppOptions{
		return {...this.appOptions};
	}

	protected constructor(appOptions:AppOptions, constantOverrides?:AppConstants) {
		super(!appOptions.disableEvents);
		this.appOptions = {
			subdomainOffset: 2,
			enableCache: true,
			env:"development",
			trustProxy: false,
			etag:true,
			ignoreRouteCase: true,
			disableEvents: false,
			view:{
				engine: "ejs",
				viewFolderPath: path.resolve("./"),
				viewFolderName: "views"
			},
			...appOptions,
		};
		this.appConstants = {
			maxChunkSizeForETag: 1000,
			jsonOptions:{
				escape: false,
				replacer: null,
				spaces: '\t',
				callbackName: "callback"
			},
			...constantOverrides
		};
		this.onError("NOT_FOUND", context => {
			if (!context.lastError) return;
			context.response
				.status(404)
				.send("Not Found: " + context.request.url);
		});
		this.onError("INTERNAL", context => {
			if (!context.lastError) return;
			if (context.environment === "development"){
				let e = context.lastError;
				context.response
					.status(500)
					.send([
						`<p style="color: red"><strong>Internal Server Error at ${context.request.url}</strong></p>`,
						`<h3 style="color: red"><strong>${e.name}:</strong> ${e.message}</h3>`,
						`<code><pre>${e.stack}</pre></code>`,
						`<br/>`,
						`<br/>`,
						`<p style="color: gray">Here's the full thing:</p>`,
						`<code style="color: dimgray"><pre>${e.toString()}</pre></code>`
					].join("\n"));
				return;
			}
			context.response
				.status(500)
				.send("Internal Server Error: " + context.request.url);
		});
	}

	listen(port:number, handler?:Function){
		this.trigger("APP:STARTING");
		let s = http.createServer((req, res) => {

			let context = new Context(this, req, res, (err?:Error)=>{

				let i = 0;
				let nextFn = (err?:Error)=>{
					if (err){
						context.lastError = err;
						this.trigger("REQUEST:ERRORED", context);
						this.appErrorHandlers.INTERNAL?.(context);
						context.response.end();
						return;
					}
					let route = this.routeStack[i];
					i++;
					if (!route) return;
					if (!route.isMatch(context)) return nextFn();
					context.next = nextFn;
					context.request.params = Object.fromEntries(Object.entries(route.params).map(([k,v])=>{
						return [decodeURIComponent(k), decodeURIComponent(v)];
					}));
					context.response.viewFolderName = route.viewFolderName;
					try{
						route.handler(context);
					}
					catch(ex){
						context.lastError = ex;
						this.trigger("REQUEST:ERRORED", context);
						this.appErrorHandlers.INTERNAL?.(context);
						context.response.end();
					}
				}

				nextFn(); //start stack walk

				if (i - 1 >= this.routeStack.length){
					context.lastError = new Error("Resource Not Found");
					this.trigger("REQUEST:NOT_FOUND", context);
					this.appErrorHandlers.NOT_FOUND?.(context);
				}

			});

			context.next(); //start the call

		});

		this.refreshRouteStack();

		s.listen(port, () => {
			this.trigger("APP:LISTENING", s);
			handler?.();
		});

		s.on("close", ()=>{ this.trigger("APP:ENDED") });

		this.subscribe("APP:ENDING", ()=>{ s.close() });

		this.trigger("APP:STARTED");

		return this;
	}

	refreshRouteStack(){
		this.trigger("ROUTES:BEFORE_REFRESH");
		this.routeStack = [];
		this.stack.forEach(controller => {
			let baseRouter = new Router(controller.viewFolder);
			baseRouter.rootPath = controller.rootPath;
			controller.init(baseRouter);
			this.routeStack.push(...baseRouter.routeStack);
		});
		this.trigger("ROUTES:AFTER_REFRESH");
		return this;
	}

	registerController(controller:Controller|ControllerKitController);
	registerController(controller:Controller|ControllerKitController, viewFolder?:string);
	registerController(viewFolder:string, controller:Controller|ControllerKitController);
	registerController(a:any, b?:any){
		let viewFolder:string;
		let controller:Controller;
		if (typeof a === "string" || a instanceof String){
			viewFolder = <string>a;
			controller = !b.hasOwnProperty('bix') ? b : Controller.Instance(b.bix.prePath, router => {
				b.bix.properties.forEach(e => {
					router['on' + e.method](e.pattern, e.handler);
				});
			});
		}
		else{
			controller = !a.hasOwnProperty('bix') ? a : Controller.Instance(a.bix.prePath, router => {
				a.bix.properties.forEach(e => {
					router['on' + e.method](e.pattern, e.handler);
				});
			});
			viewFolder = b;
		}
		controller.viewFolder = viewFolder;

		this.stack.push(controller);
		this.trigger("CONTROLLER:REGISTERED", controller);
		return this;
	}

	registerControllers(viewFolder:string, ...controllers:Array<Controller|Controller[]>)
	registerControllers(...controllers:Array<Controller|Controller[]>)
	registerControllers(...args:any[]){
		if (args.length === 0) return this;
		let first = args.shift();
		if (typeof first === "string" || first instanceof String){
			args.forEach((c:Controller) => {
				if (Array.isArray(c)){
					this.registerControllers(first, ...c);
				}
				else{
					this.registerController(first, c);
				}
			});
		}
		else{
			args.forEach((c:Controller) => {
				if (Array.isArray(c)){
					this.registerControllers(...c);
				}
				else{
					this.registerController(c);
				}
			});
		}
	}

	onError(errorName:keyof AppLevelErrorHandlers, handler:EmptyFunctionWithSingleParam<Context>){
		this.appErrorHandlers[errorName] = handler;
		return;
	}

	render(viewPath:any, model:any, callback:(err: Error | null, str: string)=>void){
		ejs.renderFile(viewPath, model, {
			async: true,
			beautify: false,
			compileDebug: this.appOptions.env === "development"
		}, callback);
	}

	updateOptions(optionPartial:Partial<AppOptions>){
		this.appOptions = {
			...this.appOptions,
			...optionPartial
		};
		return this;
	}

	public async dispose () {
		this.trigger("APP:ENDING");
		await this.options.cleanupHandler?.();
		// any other work
		super.destroy();
	}

	public clone():App{
		let a = new App(this.appOptions, this.appConstants);
		a.stack = [...this.stack];
		a.routeStack = [...this.routeStack];
		a.baseRouter = new Router(a.baseRouter);
		a.baseRouter.routeStack = [...this.baseRouter.routeStack];
		return a;
	}

}

export class App extends Application{
	constructor(options?:AppOptions, constantOverrides?:AppConstants) {
		super({...options}, {...constantOverrides});
	}
}