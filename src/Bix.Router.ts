import {Context} from "./Bix.Context";
import {ApplicationError} from "./Bix";
import {EmptyFunction, parseUrlPattern} from "./Bix.Utils";


export type AsyncControllerHandler = (router:Router) => void;

export type AsyncRequestHandler = (context:Context, next?:Function) => Promise<void>|void;

export class Controller {

	public readonly init:AsyncControllerHandler;
	public readonly rootPath:string = "/";

	constructor(handler: AsyncControllerHandler);
	constructor(routePath:string, handler: AsyncControllerHandler);
	constructor(routePathOrHandler:string|AsyncControllerHandler, handler?:AsyncControllerHandler) {
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

	public static Instance(handler:AsyncControllerHandler);
	public static Instance(routePath:string, handler:AsyncControllerHandler);
	public static Instance(routeOrPath:any, handler?:AsyncControllerHandler){
		return new Controller(routeOrPath, handler);
	}

}

export class Router{

	public routeStack:Array<Route> = [];

	onGET(path:string, handler:AsyncRequestHandler){
		this.routeStack.push(new Route(path, "GET", handler));
	}

}

export class Route {
	public pathPattern:string = "";
	public method:string = "GET";
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
		let o = parseUrlPattern(this.pathPattern, context.request.url, context.app.options.ignoreRouteCase);
		this.params = o.matches;
		return o.isMatch;
	}

	isMatch(context:Context){
		return this.isMethodMatch(context) && this.isPathMatch(context);
	}
}