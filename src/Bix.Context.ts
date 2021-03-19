import * as http from "http";
import * as accepts from "accepts";
import * as parseRange from "range-parser";
import * as typeis from "type-is";
import {App, AppEnvironments, ApplicationError} from "./Bix.Application";
import {
	getIP,
	getAllIPs,
	toTrustCheckFunction,
	toMakeETagFunction,
	isAbsolute,
	normalizeTypes,
	normalizeType,
	setCharset,
	EmptyFunctionWithParam,
	EmptyFunction,
	IDisposable
} from "./Bix.Utils";
import {isIP} from "net";
import * as fresh from "fresh";
import * as send from "send";
import * as statuses from "statuses";
import * as onFinished from "on-finished";
import * as contentDisposition from "content-disposition";
import {resolve, extname, join} from "path";
import {sign} from "cookie-signature";
import * as cookie from "cookie";
import * as encodeUrl from "encodeurl";
import * as escapeHtml from "escape-html";
import * as vary from "vary";

const charsetRegExp = /;\s*charset\s*=/;

class ParsedURL{
	public readonly query:{[name:string]:string} = {};

	constructor(url:string) {
		this.query = ParsedURL.parseQuery(url);
	}

	private static parseQuery(url:string){
		let firstIndex = url.indexOf("?");
		if (firstIndex === -1) return {};
		url = url.substr(firstIndex + 1);
		if (url.length === 0) return {};
		let parts = url.split("&");
		let obj = {};
		parts.forEach(part => {
			let [key,value] = part.split("=");
			let val = decodeURIComponent(value);
			obj[decodeURIComponent(key)] = ParsedURL.normalizeValue(val);
		});
		return obj;
	}

	private static normalizeValue(value:string){
		if ( !isNaN(+value) ) return Number(value);
		if ( value === "true" || value === "false" ) return value === "true";
		return value;
	}
}

class Request{

	private readonly requestUrl:ParsedURL;
	private readonly app:App;
	private readonly context:Context;
	private readonly internalReq:http.IncomingMessage;

	public next:EmptyFunctionWithParam<any>;
	public params = {};

	constructor(req:http.IncomingMessage, context:Context, next:EmptyFunctionWithParam<any>) {
		this.app = context.app;
		this.requestUrl = new ParsedURL(req.url);
		this.context = context;
		this.next = next;
		this.internalReq = req;
	}

	private get socket(){
		return this.internalReq.socket;
	}

	get parsedUrl(){
		return this.requestUrl;
	}

	get url(){
		return this.internalReq.url;
	}

	get method(){
		return this.internalReq.method;
	}

	get headers(){
		return this.internalReq.headers;
	}

	get secure(){
		return this.protocol === 'https';
	}

	get body(){
		throw new Error("Not Implemented");
		return {}
	}

	get query(){
		return this.requestUrl.query;
	}

	get protocol(){
		let proto = this.secure ? 'https' : 'http';
		let trust = toTrustCheckFunction(this.app.options.trustProxy);

		if (!trust(this.socket.remoteAddress, 0)) return proto;

		// Note: X-Forwarded-Proto is normally only ever a
		//       single value, but this is to be safe.
		let header = this.header('X-Forwarded-Proto') || proto;
		let index = header.indexOf(',');

		return index !== -1
			? header.substring(0, index).trim()
			: header.trim()
	}

	get ip(){
		let trust = toTrustCheckFunction(this.app.options.trustProxy);
		return getIP(this, trust);
	}

	get ips(){
		let trust = toTrustCheckFunction(this.app.options.trustProxy);
		let addrs = getAllIPs(this, trust);

		// reverse the order (to farthest -> closest)
		// and remove socket address
		addrs.reverse().pop();

		return addrs;
	}

	get hostname(){
		let trust = toTrustCheckFunction(this.app.options.trustProxy);
		let host:string = this.header('X-Forwarded-Host');

		if (!host || !trust(this.socket.remoteAddress, 0)) {
			host = this.header('Host');
		} else if (host.indexOf(',') !== -1) {
			// Note: X-Forwarded-Host is normally only ever a
			//       single value, but this is to be safe.
			host = host.substring(0, host.indexOf(',')).trimRight()
		}

		if (!host) return;

		// IPv6 literal support
		let offset = host[0] === '[' ? host.indexOf(']') + 1 : 0;
		let index = host.indexOf(':', offset);

		return index !== -1
			? host.substring(0, index)
			: host;
	}

	get subdomains() {
		let hostname = this.hostname;

		if (!hostname) return [];

		let offset = this.app.options.subdomainOffset;
		let subdomains = !isIP(hostname) ? hostname.split('.').reverse() : [hostname];

		return subdomains.slice(offset);
	}

	get fresh(){
		let method = this.method;
		let res = this.context.response;
		let status = res.statusCode

		// GET or HEAD for weak freshness validation only
		if ('GET' !== method && 'HEAD' !== method) return false;

		// 2xx or 304 as per rfc2616 14.26
		if ((status >= 200 && status < 300) || 304 === status) {
			return fresh(this.headers, {
				'etag': res.get('ETag'),
				'last-modified': res.get('Last-Modified')
			})
		}

		return false;
	}

	get stale(){
		return !this.fresh;
	}

	get xhr(){
		let val:string = this.header('X-Requested-With') || '';
		return val.toLowerCase() === 'xmlhttprequest';
	}

	get<T>(headerName:string):T{
		return this.header<T>(headerName);
	}

	header<T = string|string[]>(headerName:string):T{
		if (!headerName) throw new TypeError("header name is required when getting header value");
		if (typeof headerName !== "string" && !(<any>headerName instanceof String)){
			throw new TypeError("headerName must be of type string");
		}
		let name = headerName.toLowerCase();

		if (['referer','referrer'].indexOf(name) > -1){
			return <T><unknown>(this.headers.referer);
		}
		return <T><unknown>this.headers[name];
	}

	accepts(...args:Array<string|string[]>){
		let acc = accepts(this);
		return (<Function>acc.types).apply(acc, args);
	}

	acceptsEncodings(...encodings:Array<string>){
		let acc = accepts(this);
		return acc.encodings.apply(acc, encodings);
	};

	acceptsCharsets(...charsets:Array<string>){
		let acc = accepts(this);
		return acc.charsets.apply(acc, charsets);
	};

	acceptsLanguages(...lang:Array<string>){
		let acc = accepts(this);
		return acc.languages.apply(acc, lang);
	};

	range(size, options) {
		let range = this.header('Range');
		if (!range) return;
		return parseRange(size, range, options);
	};

	is(...types:Array<string>) {
		return typeis(this, types);
	}


}

class Response{

	private readonly context:Context;
	private readonly internalRes:http.ServerResponse;

	public viewFolderName:string = null;

	public locals: {[name:string]:any} = {};

	constructor(res:http.ServerResponse, context:Context) {
		this.internalRes = res;
		this.context = context;
	}

	get statusCode(){
		return this.internalRes.statusCode;
	}

	get(field:string){
		return this.getHeader(field);
	}

	private getHeader(field:string){
		return this.internalRes.getHeader(field);
	}

	set(field:string|object, value?:any){
		return this.header(field, value);
	}

	header(field:string|object, value?:any){
		if (arguments.length === 2 && (typeof field === "string" || field instanceof String)) {
			let val = Array.isArray(value) ? value.map(String) : String(value);

			// add charset to content-type
			if (field.toLowerCase() === 'content-type') {
				if (Array.isArray(val)) {
					throw new TypeError('Content-Type cannot be set to an Array');
				}
				if (!charsetRegExp.test(val)) {
					let charset = send.mime.charsets.lookup(val.split(';')[0]);
					if (charset) val += '; charset=' + charset.toLowerCase();
				}
			}

			this.setHeader(field.toString(), val);
		} else {
			for (let [k, v] of Object.entries(field)) {
				this.set(k, v);
			}
		}
		return this;
	}

	private setHeader(field:string, val:any){
		this.internalRes.setHeader(field, val);
	}

	private removeHeader(field:string){
		this.internalRes.removeHeader(field);
	}

	status(code) {
		this.internalRes.statusCode = code;
		return this;
	};

	links(links){
		let link = this.get('Link') || '';
		if (link) link += ', ';
		return this.set('Link', link + Object.keys(links).map(function(rel){
			return '<' + links[rel] + '>; rel="' + rel + '"';
		}).join(', '));
	}

	json(content) {
		let {escape, replacer, spaces} = this.context.app.appConstants.jsonOptions;

		replacer = replacer ?? (() => {
			const seen = new WeakSet();
			return (key, value) => {
				if (typeof value === "object" && value !== null) {
					if (seen.has(value)) {
						return "[CIRCULAR]";
					}
					seen.add(value);
				}
				return value;
			};
		})();

		let body = Response.stringify(content, replacer, spaces, escape)

		// content-type
		if (!this.get('Content-Type')) {
			this.set('Content-Type', 'application/json');
		}

		return this.send(body);
	}

	jsonp(content) {
		let {escape, replacer, spaces, callbackName} = this.context.app.appConstants.jsonOptions;
		let body = Response.stringify(content, replacer, spaces, escape)
		let callback = this.context.request.query[callbackName];

		// content-type
		if (!this.get('Content-Type')) {
			this.set('X-Content-Type-Options', 'nosniff');
			this.set('Content-Type', 'application/json');
		}

		// fixup callback
		if (Array.isArray(callback)) {
			callback = callback[0];
		}

		// jsonp
		if (typeof callback === 'string' && callback.length !== 0) {
			this.set('X-Content-Type-Options', 'nosniff');
			this.set('Content-Type', 'text/javascript');

			// restrict callback charset
			callback = callback.replace(/[^\[\]\w$.]/g, '');

			// replace chars not allowed in JavaScript that are in JSON
			body = body
				.replace(/\u2028/g, '\\u2028')
				.replace(/\u2029/g, '\\u2029');

			// the /**/ is a specific security mitigation for "Rosetta Flash JSONP abuse"
			// the typeof check is just to reduce client error noise
			body = '/**/ typeof ' + callback + ' === \'function\' && ' + callback + '(' + body + ');';
		}

		return this.send(body);
	}

	send(chunk:any) {
		let encoding;
		let req = this.context.request;
		let type;

		switch (typeof chunk) {
			// string defaulting to html
			case 'string':
				if (!this.get('Content-Type')) this.type('html');
				break;
			case 'boolean':
			case 'number':
			case 'object':
				if (chunk === null) chunk = '';
				else if (Buffer.isBuffer(chunk)) {
					if (!this.get('Content-Type')) this.type('bin');
				} else if (chunk instanceof String){
					if (!this.get('Content-Type')) this.type('html');
				} else {
					return this.json(chunk);
				}
				break;
		}

		// write strings in utf-8
		if (typeof chunk === 'string' || chunk instanceof String) {
			encoding = 'utf8';
			type = this.get('Content-Type');

			// reflect this in content-type
			if (typeof type === 'string') {
				this.set('Content-Type', setCharset(type, 'utf-8'));
			}
		}

		// determine if ETag should be generated
		let etagFn = toMakeETagFunction(this.context.app.options.etag);
		let generateETag = !this.get('ETag') && typeof etagFn === 'function'

		// populate Content-Length
		let len
		if (chunk !== undefined) {
			if (Buffer.isBuffer(chunk)) {
				len = chunk.length
			} else if (!generateETag && chunk.length < this.context.app.appConstants.maxChunkSizeForETag) {
				len = Buffer.byteLength(chunk, encoding)
			} else {
				// convert chunk to Buffer and calculate
				chunk = Buffer.from(chunk, encoding)
				encoding = undefined;
				len = chunk.length
			}

			this.set('Content-Length', len);
		}

		// populate ETag
		let etag;
		if (generateETag && len !== undefined) {
			if ((etag = etagFn(chunk, encoding))) {
				this.set('ETag', etag);
			}
		}

		// freshness
		if (req.fresh) this.status(304);

		// strip irrelevant headers
		if (204 === this.statusCode || 304 === this.statusCode) {
			this.removeHeader('Content-Type');
			this.removeHeader('Content-Length');
			this.removeHeader('Transfer-Encoding');
			chunk = '';
		}

		if (req.method === 'HEAD') {
			this.end();
		} else {
			this.end(chunk, encoding);
		}

		return this;
	}

	end(cb?: EmptyFunction): void;
	end(chunk: any, cb?: EmptyFunction): void;
	end(chunk: any, encoding: BufferEncoding, cb?: EmptyFunction): void;
	end(chunkOrCallback: any, encodingOrCallback?:BufferEncoding|EmptyFunction, callback?: EmptyFunction){

		switch (arguments.length){
			case 3: {
				return this.internalRes.end(chunkOrCallback, <BufferEncoding>encodingOrCallback, callback);
			}
			case 2:{
				let chunk = chunkOrCallback;
				callback = <EmptyFunction>encodingOrCallback;
				return this.internalRes.end(chunk, callback);
			}
			case 1:{
				return this.internalRes.end(callback);
			}
			default:{
				this.internalRes.end();
			}
		}

	}

	sendStatus(statusCode:number) {
		let body = statuses[statusCode] || String(statusCode)

		this.status(statusCode);
		this.type('txt');

		return this.send(body);
	}

	sendFile(path:string, options, callback) {
		let req = this.context.request;
		let next = req.next;
		let opts = options || {};

		if (!path) throw new TypeError('path argument is required to sendFile');

		if (typeof path !== 'string' && !(<any>path instanceof String)) {
			throw new TypeError('path must be a string to sendFile')
		}

		// support function as second arg
		if (typeof options === 'function') {
			callback = options;
			opts = {};
		}

		if (!opts.root && !isAbsolute(path)) {
			throw new TypeError('path must be absolute or specify root to res.sendFile');
		}

		// create file stream
		let pathname = encodeURI(path);
		let file = send(req, pathname, opts);

		// transfer
		Response.pipeSendFileStream(this.context.request, file, opts, function (err) {
			if (callback) return callback(err);
			if (err && err.code === 'EISDIR') return next();

			// next() all but write errors
			if (err && err.code !== 'ECONNABORTED' && err.syscall !== 'write') {
				next(err);
			}
		});
	}

	download(path:string, filename:string, options, callback) {
		let name = filename;
		let opts = options || null

		// support function as second or third arg
		if (typeof filename === 'function') {
			callback = filename;
			name = null;
			opts = null
		} else if (typeof options === 'function') {
			callback = options
			opts = null
		}

		// set Content-Disposition when file is sent
		let headers = {
			'Content-Disposition': contentDisposition(name || path)
		};

		// merge user-provided headers
		if (opts && opts.headers) {
			let keys = Object.keys(opts.headers)
			for (let i = 0; i < keys.length; i++) {
				let key = keys[i]
				if (key.toLowerCase() !== 'content-disposition') {
					headers[key] = opts.headers[key]
				}
			}
		}

		// merge user-provided options
		opts = Object.create(opts)
		opts.headers = headers

		// Resolve the full path for sendFile
		let fullPath = resolve(path);

		// send file
		return this.sendFile(fullPath, opts, callback)
	}

	contentType(type:string){
		return this.type(type);
	}

	type(type:string) {
		let contentType = type.indexOf('/') === -1 ? send.mime.lookup(type) : type;
		return this.set('Content-Type', contentType);
	};

	format(obj){
		let req = this.context.request;
		let next = req.next;

		let fn = obj.default;
		if (fn) delete obj.default;
		let keys = Object.keys(obj);

		let key = keys.length > 0 ? req.accepts(keys) : false;

		this.vary("Accept");

		if (key) {
			this.set('Content-Type', normalizeType(key).value);
			obj[key](req, this, next);
		} else if (fn) {
			fn();
		} else {
			let err = new ApplicationError.AppRequestError('Not Acceptable');
			err.status = err.statusCode = 406;
			err.types = normalizeTypes(keys).map(function(o){ return o.value });
			next(err);
		}

		return this;
	}

	attachment(filename:string) {
		if (filename) {
			this.type(extname(filename));
		}

		this.set('Content-Disposition', contentDisposition(filename));

		return this;
	}

	append(field:string, value:string) {
		let prev = this.get(field);

		if (!prev) return this.set(field, value);

		let fValue = Array.isArray(prev) ? prev.concat(value)
			: Array.isArray(value) ? [prev].concat(value)
				: [prev, value];

		return this.set(field, fValue);
	}

	clearCookie(name, options) {
		let opts = {
			expires: new Date(1),
			path: '/',
			...options
		};

		return this.cookie(name, '', opts);
	}

	cookie(name:string, value:any, options) {
		let opts = {...options};
		let secret = this.context.request['secret']; // TODO fix this
		let signed = opts.signed;

		if (signed && !secret) {
			throw new Error('cookieParser("secret") required for signed cookies');
		}

		let val = typeof value === 'object' ? 'j:' + JSON.stringify(value) : String(value);

		if (signed) {
			val = 's:' + sign(val, secret);
		}

		if ('maxAge' in opts) {
			opts.expires = new Date(Date.now() + opts.maxAge);
			opts.maxAge /= 1000;
		}

		if (opts.path == null) {
			opts.path = '/';
		}

		this.append('Set-Cookie', cookie.serialize(name, String(val), opts));

		return this;
	}

	location(url) {
		let loc = url;

		// "back" is an alias for the referrer
		if (url === 'back') {
			loc = this.context.request.get('Referrer') || '/';
		}

		// set location
		return this.set('Location', encodeUrl(loc));
	}

	redirect(status:number, address:string)
	redirect(address:number)
	redirect(statusOrUrl:number|string, address?:string) {
		let body;
		let status:number = 302;

		if (typeof statusOrUrl === "number") status = statusOrUrl;
		if (typeof statusOrUrl === "string") address = statusOrUrl;

		// Set location header
		address = <string>this.location(address).get('Location');

		// Support text/{plain,html} by default
		this.format({
			text: function(){
				body = statuses[status] + '. Redirecting to ' + address
			},

			html: function(){
				let u = escapeHtml(address);
				body = '<p>' + statuses[status] + '. Redirecting to <a href="' + u + '">' + u + '</a></p>'
			},

			default: function(){
				body = '';
			}
		});

		// Respond
		this.status(status);
		this.set('Content-Length', Buffer.byteLength(body));

		if (this.context.request.method === 'HEAD') {
			this.end();
		} else {
			this.end(body);
		}
	}

	vary(field:string){
		vary(this, field);
		return this;
	}

	render(view, options, callback:(err:Error, value:string)=>void) {
		let app = this.context.app;
		let done = callback;
		let req = this.context.request;
		let self = this;

		let viewFolder = join(app.options.view.viewFolderPath, this.viewFolderName ?? app.options.view.viewFolderName);
		let fullViewPath = join(viewFolder, view);

		console.log({fullViewPath});

		// default callback to respond
		done = done || ((err, str) => {
			if (err) return req.next(err);
			self.send(str);
		});

		// render
		app.render(fullViewPath, {
			...this.locals,
			...options
		}, done);
	}

	private static stringify (value: any, replacer, spaces:string, escape:boolean) {
		// v8 checks arguments.length for optimizing simple call
		// https://bugs.chromium.org/p/v8/issues/detail?id=4730
		let json = replacer || spaces
			? JSON.stringify(value, replacer, spaces)
			: JSON.stringify(value);

		if (escape) {
			json = json.replace(/[<>&]/g, function (c) {
				switch (c.charCodeAt(0)) {
					case 0x3c:
						return '\\u003c'
					case 0x3e:
						return '\\u003e'
					case 0x26:
						return '\\u0026'
					/* istanbul ignore next: unreachable default */
					default:
						return c
				}
			})
		}

		return json
	}

	private static pipeSendFileStream(res, file, options, callback) {
		let isDone = false;
		let streaming;

		// request aborted
		function onaborted() {
			if (isDone) return;
			isDone = true;

			let err = new ApplicationError.AppContextError('Request aborted');
			err.code = 'ECONNABORTED';
			callback(err);
		}

		// directory
		function ondirectory() {
			if (isDone) return;
			isDone = true;

			let err = new ApplicationError.AppContextError('EISDIR, read');
			err.code = 'EISDIR';
			callback(err);
		}

		// errors
		function onerror(err) {
			if (isDone) return;
			isDone = true;
			callback(err);
		}

		// ended
		function onend() {
			if (isDone) return;
			isDone = true;
			callback();
		}

		// file
		function onfile() {
			streaming = false;
		}

		// finished
		function onfinish(err) {
			if (err && err.code === 'ECONNRESET') return onaborted();
			if (err) return onerror(err);
			if (isDone) return;

			setImmediate(function () {
				if (streaming !== false && !isDone) {
					onaborted();
					return;
				}

				if (isDone) return;
				isDone = true;
				callback();
			});
		}

		// streaming
		function onstream() {
			streaming = true;
		}

		file.on('directory', ondirectory);
		file.on('end', onend);
		file.on('error', onerror);
		file.on('file', onfile);
		file.on('stream', onstream);
		onFinished(res, onfinish);

		if (options.headers) {
			// set headers on successful transfer
			file.on('headers', function headers(res) {
				let obj = options.headers;
				let keys = Object.keys(obj);

				for (let k of keys){
					res.setHeader(k, obj[k]);
				}
			});
		}

		// pipe
		file.pipe(res);
	}

}

export class Context implements IDisposable{

	public readonly environment: AppEnvironments = "development";

	public next:Function = ()=>{};
	public lastError: Error = null;

	private __request: Request;
	private __response: Response;

	public get request(){ return this.__request }
	public get response(){ return this.__response }

	constructor(public app:App, req:http.IncomingMessage, res:http.ServerResponse, next){
		this.__request = new Request(req, this, next);
		this.__response = new Response(res, this);
		this.environment = app.options.env;
		this.next = next;
		return this;
	}

	dispose() {
		this.__response = null;
		this.__request = null;
	}

}