import * as proxyaddr from "proxy-addr";
import * as etag from "etag";
import * as send from "send";
import * as contentType from "content-type";
import {Context} from "./Bix.Context";

export interface IDisposable{
	dispose():void;
}

export type EmptyFunction = ()=>void;
export type EmptyFunctionWithParam<T> = (...args:T[])=>void;
export type EmptyFunctionWithSingleParam<T> = (arg:T)=>void;
export type FunctionWithParam<T,O> = (...args:T[])=>O;

export function createETagGenerator (options) {
	return function generateETag (body, encoding) {
		let buf = !Buffer.isBuffer(body)
			? Buffer.from(body, encoding)
			: body

		return etag(buf, options)
	}
}

export function toMakeETagFunction(val){
	if (typeof val === 'function') return val;

	switch (val) {
		case true:
			return createETagGenerator({ weak: true });
		case false:
			break;
		case 'strong':
			return createETagGenerator({ weak: false });
		case 'weak':
			return createETagGenerator({ weak: true });
		default:
			throw new TypeError('unknown value for etag function: ' + val);
	}
}

export function toTrustCheckFunction(val) {
	if (typeof val === 'function') return val;

	if (val === true) return function(){ return true };

	if (typeof val === 'number' || val instanceof Number) return function(a, i){ return i < val };

	if (typeof val === 'string') {
		val = val.split(",").map(k => k.trim());
	}

	return proxyaddr.compile(val || []);
}

export function getIP(req, trustProxy:any){
	return proxyaddr(req, toTrustCheckFunction(trustProxy));
}

export function getAllIPs(req, trustProxy:any){
	return proxyaddr.all(req, toTrustCheckFunction(trustProxy));
}

export function isAbsolute(path:string){
	if ('/' === path[0]) return true;
	if (':' === path[1] && ('\\' === path[2] || '/' === path[2])) return true; // Windows device path
	if ('\\\\' === path.substring(0, 2)) return true; // Microsoft Azure absolute path
}

function acceptParams(str:string, index?:number) {
	let parts = str.split(/ *; */);
	let ret = { value: parts[0], quality: 1, params: {}, originalIndex: index };

	for (let i = 1; i < parts.length; ++i) {
		let pms = parts[i].split(/ *= */);
		if ('q' === pms[0]) {
			ret.quality = parseFloat(pms[1]);
		} else {
			ret.params[pms[0]] = pms[1];
		}
	}

	return ret;
}

export function normalizeTypes(types:Array<string>){
	return types.map(type => {
		return normalizeType(type);
	});
}

export function normalizeType(type:string){
	return ~type.indexOf('/') ? acceptParams(type) : { value: send.mime.lookup(type), params: {} };
}

export function setCharset(type:string, charset:string) {
	if (!type || !charset) {
		return type;
	}

	// parse type
	let parsed = contentType.parse(type);

	// set charset
	parsed.parameters.charset = charset;

	// format type
	return contentType.format(parsed);
}

export function parseUrlPattern(pattern:string, url:string, ignoreCase:boolean=false){
	url = url.replace(/\/{2,}/gm,"/");

	if ((ignoreCase && url.toLowerCase() === pattern.toLowerCase()) || (!ignoreCase && url === pattern)){
		return {
			isMatch: true,
			matches: {}
		}
	}

	const regx = /(?:\/:([a-z0-9_-]+)|\*|\/\*\?)/gmi;

	let m = {};
	let k = [];
	let wildCardCount = 0;

	let w = pattern.replace(regx, (substring, g1, l) => {
		if (substring === "/*?"){
			k.push(wildCardCount);
			wildCardCount++;
			return "/?(.*)";
		}
		else if (substring === "*"){
			k.push(wildCardCount);
			wildCardCount++;
			return "(.+)";
		}
		else{
			k.push(g1);
			return "/([a-z0-9_-]+)";
		}
	});

	let r = new RegExp("^" + w, "gm" + (ignoreCase ? "i" : ""));

	let v = r.exec(url);

	if (v){
		for (let i = 0; i < v.length - 1; i++){
			m[ k[i] ] = v[i + 1]
		}
	}

	return {
		isMatch: Object.keys(m).length > 0,
		matches: m
	}

}

export namespace Performance{

	export function LogPerformance(context:Context, whenExceedsTimeInMs: number = 5, whenExceedsCalls: number = 30): any {
		return function<T>(target: T, key: keyof T, descriptor?): any {
			descriptor =
				descriptor || Object.getOwnPropertyDescriptor(target, key) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), key);
			const originalMethod = descriptor.value;

			if (!(process.env.IS_PROD != "true" && context.environment === "development")) {
				return originalMethod;
			}

			const log = (message: string) => {
				console.log(message, 'color: red;');
			};

			const debouncedLog = LogUtilities.debounce(log, 1000);
			const parentName = ((target || {}).constructor || <any>{}).name || 'UNKNOWN';
			const caller = `${parentName}:${key}`;
			let calls = 0;
			let totalElapsed = 0;

			descriptor.value = function() {
				calls++;
				const p = require('perf_hooks');
				const t0 = p.performance.now();
				const result = originalMethod.apply(this, arguments);
				const t1 = p.performance.now();
				const elapsed = Math.round((t1 - t0) * 10) / 10;

				totalElapsed += elapsed;

				if (elapsed > whenExceedsTimeInMs || totalElapsed > whenExceedsTimeInMs || calls > whenExceedsCalls) {
					const elapsedStr = LogUtilities.padStart(Math.round(elapsed).toLocaleString(), ' ', 10);
					const totalStr = LogUtilities.padEnd(Math.round(totalElapsed).toLocaleString() + 'ms', ' ', 10);
					const callsStr = LogUtilities.padEnd(calls.toLocaleString(), ' ', 10);
					const message = `%c ${elapsedStr}ms | total: ${totalStr} | calls: ${callsStr} | ${caller}`;
					debouncedLog(message);
				}

				return result;
			};

			return descriptor;
		};
	}

	namespace LogUtilities{
		export function padStart(val: string, padStr: string, len: number): string {
			return pad(val, padStr, len, false);
		}

		export function padEnd(val: string, padStr: string, len: number): string {
			return pad(val, padStr, len, true);
		}

		export function pad(val: string, padStr: string, len: number, toEnd: boolean): string {
			if (val.length > len) {
				return val;
			} else {
				len -= val.length;

				while (len > padStr.length) {
					padStr += padStr;
				}

				return toEnd ? val + padStr.slice(0, len) : padStr.slice(0, len) + val;
			}
		}

		export function debounce(func: (...args: any[]) => void, wait: number): (...args: any[]) => void {
			let timeout: any;

			return function() {
				const context = this;
				const args = arguments;
				const later = function() {
					timeout = null;
					func.apply(context, args);
				};

				clearTimeout(timeout);
				timeout = setTimeout(later, wait);
			};
		}
	}

}