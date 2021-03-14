import {Context} from "./Bix.Context";
import {ApplicationError} from "./Bix";
import {EmptyFunction, parseUrlPattern} from "./Bix.Utils";


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

	onGET(path:string, handler:AsyncRequestHandler){
		let r = new Route(path, "GET", handler);
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