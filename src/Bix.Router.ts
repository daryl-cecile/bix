import {Context} from "./Bix.Context";
import {ApplicationError} from "./Bix.Application";
import {EmptyFunction, parseUrlPattern} from "./Bix.Utils";
import {v4 as uuid} from 'uuid';


export type ControllerHandler = (router:Router) => void;

export type AsyncRequestHandler = (context:Context, next?:Function) => Promise<void>|void;

export class Controller {

	public readonly init:ControllerHandler;
	public readonly rootPath:string = "/";
	public viewFolder:string = "";

	constructor(handler: ControllerHandler);
	constructor(routePath:string, handler: ControllerHandler);
	constructor(routePathOrHandler:string|ControllerHandler, handler?:ControllerHandler) {
		if (typeof routePathOrHandler === "string" && !handler){
			throw new ApplicationError.AppCycleError("Unable to create a controller without handler");
		}
		if (typeof routePathOrHandler === "string" || routePathOrHandler instanceof String) {
			this.rootPath = <string>routePathOrHandler;
			this.init = handler;
		} else {
			this.init = routePathOrHandler;
		}
	}

	public static Instance(handler:ControllerHandler);
	public static Instance(routePath:string, handler:ControllerHandler);
	public static Instance(routeOrPath:any, handler?:ControllerHandler){
		return new Controller(routeOrPath, handler);
	}

}

export class Router{

	public routeStack:Array<Route> = [];
	public rootPath:string = "/";
	protected viewFolderPath:string = "";

	constructor(oldRouter:Router)
	constructor(viewFolderPath:string)
	constructor(viewFolderPathOrRouter:any) {
		if (viewFolderPathOrRouter === void 0 || viewFolderPathOrRouter === null){
			this.viewFolderPath = null;
		}
		else if (typeof viewFolderPathOrRouter === "string" || viewFolderPathOrRouter instanceof String){
			this.viewFolderPath = <string>viewFolderPathOrRouter;
		}
		else{
			this.viewFolderPath = viewFolderPathOrRouter.viewFolderPath;
		}
	}

	private static joinPath(...parts:Array<string>){
		return parts.join("/").replace(/\/{2,}/gm, "/");
	}

	onGET(path:string, handler:AsyncRequestHandler){
		let r = new Route(Router.joinPath(this.rootPath,path), "GET", handler);
		r.viewFolderName = this.viewFolderPath;
		this.routeStack.push(r);
	}

}

export class Route {
	public pathPattern:string = "";
	public method:string = "GET";
	public viewFolderName:string = "";
	public handler:AsyncRequestHandler = ()=>{};

	constructor(pathPattern:string, method:string, handler:AsyncRequestHandler) {
		this.pathPattern = pathPattern;
		this.method = method;
		this.handler = handler;
	}

	public params:{
		[index:number]:any,
		[key:string]:any
	} = {};

	isMethodMatch(context:Context){
		if (this.method === "ALL") return true;
		return context.request.method.toUpperCase() === this.method.toUpperCase();
	}

	isPathMatch(context:Context){
		let o = parseUrlPattern(this.pathPattern, context.request.url.split("?")[0], context.app.options.ignoreRouteCase);
		this.params = o.matches;
		return o.isMatch;
	}

	isMatch(context:Context){
		return this.isMethodMatch(context) && this.isPathMatch(context);
	}
}

export type ControllerKitController = {
	bix:{
		prePath:string,
		properties: Array<{
			method: string,
			pattern: string,
			handler: Function
		}>
	}
	[property:string]: any
}

export namespace ControllerKit{
	let definitions = {};

	function registerMethod<T>(method:string, target:T, pattern, descriptor, key:keyof T, overrideName:boolean=false){
		if (!target.constructor.hasOwnProperty("__bix")) {
			let id = uuid();
			target.constructor['__bix'] = id;
			definitions[id] = {
				prePath: null,
				properties: []
			};
		}
		definitions[ target.constructor['__bix'] ].properties.push({
			method: method,
			pattern: pattern ? (overrideName ? pattern : [key, pattern].join("/")) : key,
			handler: descriptor.value
		});
	}

	export function Controller(pathOverride?:string):any{
		return function<T>(target:T, key:keyof T, descriptor?): any {
			let identifier = target['__bix'];
			definitions[ identifier ].prePath = "/" + (pathOverride ?? target['name'] ?? "");
			target['bix'] = definitions[ identifier ];
			definitions[ identifier ] = undefined;
		}
	}

	export function GET(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("GET", target, pattern, descriptor, key, overrideName);
		}
	}

	export function POST(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("POST", target, pattern, descriptor, key, overrideName);
		}
	}

	export function PUT(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("PUT", target, pattern, descriptor, key, overrideName);
		}
	}

	export function DELETE(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("DELETE", target, pattern, descriptor, key, overrideName);
		}
	}

	export function OPTIONS(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("OPTIONS", target, pattern, descriptor, key, overrideName);
		}
	}

	export function HEAD(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("HEAD", target, pattern, descriptor, key, overrideName);
		}
	}

	export function CONNECT(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("CONNECT", target, pattern, descriptor, key, overrideName);
		}
	}

	export function TRACE(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("TRACE", target, pattern, descriptor, key, overrideName);
		}
	}

	export function PATCH(pattern?:string, overrideName:boolean=false): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			registerMethod("PATCH", target, pattern, descriptor, key, overrideName);
		}
	}
}