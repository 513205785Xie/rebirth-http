import { Injectable, Inject, Optional } from '@angular/core';
import {
    Http,
    Jsonp,
    Headers as ngHeaders,
    URLSearchParams,
    Request,
    Response,
    RequestMethod,
    RequestOptions
} from '@angular/http';
import { Observable } from 'rxjs/Observable';

/// <reference path="../node_modules/@angular/platform-browser/src/browser.d.ts" />

function isObject(value): boolean {
    return value !== null && typeof value === 'object';
}

export interface RebirthHttpInterceptor {
    request?: (option: RequestOptions) => RequestOptions | void;
    response?: (response: Observable<any>) => Observable<any> | void;
}

@Injectable()
export class RebirthHttpProvider {
    private interceptors: RebirthHttpInterceptor[];

    constructor() {
        this.interceptors = [];
    }

    getInterceptors() {
        return this.interceptors;
    }

    addInterceptor(interceptor: RebirthHttpInterceptor): RebirthHttpProvider {
        this.interceptors.push(interceptor);
        return this;
    }

    handleRequest(req: RequestOptions): RequestOptions {
        return this.interceptors
            .filter(item => !!item.request)
            .reduce((req, item) => {
                return <RequestOptions>(item.request(req) || req);
            }, req);
    }

    handleResponse(res: Observable<any>): Observable<any> {
        return this.interceptors
            .filter(item => !!item.response)
            .reverse()
            .reduce((stream, item) => {
                return <Observable<any>>(item.response(stream) || res);
            }, res);
    }

    baseUrl(host: string): RebirthHttpProvider {
        this.interceptors.push({
            request: (request: RequestOptions): void => {
                if (!/^https?:/.test(request.url)) {
                    host = host.replace(/\/$/, "");
                    let url = request.url.replace(/^\//, "");
                    request.url = `${host}/${url}`;
                }
            }
        });

        return this;
    }

    json(): RebirthHttpProvider {
        this.interceptors.push({
            request: (request: RequestOptions): void => {
                request.headers = request.headers || new ngHeaders();
                request.headers.set('Content-Type', 'application/json');
                request.headers.set('Accept', 'application/json, text/javascript, */*;');

                if (request.body) {
                    request.body = JSON.stringify(request.body);
                }
            },
            response: (response: Observable<any>): Observable<any> => {
                return response.map(res => {
                    let type = res.headers.get('content-type');
                    if (type.indexOf('json') !== -1) {
                        return res.json && res.json();
                    }
                });
            }
        });
        return this;
    }
}

export class RebirthHttp {
    protected http: Http;
    protected jsonp: Jsonp;
    protected rebirthHttpProvider: RebirthHttpProvider;

    constructor({ http, jsonp, rebirthHttpProvider }:
        {http?: Http, jsonp?: Jsonp, rebirthHttpProvider ?: RebirthHttpProvider}) {
        this.http = http;
        this.jsonp = jsonp;
        this.rebirthHttpProvider = rebirthHttpProvider;
    }

    protected getBaseUrl(): string {
        return '';
    }

    protected getDefaultHeaders(): Object {
        return null;
    }

    protected  requestInterceptor(req: RequestOptions): RequestOptions | void {
        if (this.rebirthHttpProvider) {
            return this.rebirthHttpProvider.handleRequest(req);
        }
        return req;
    }

    protected responseInterceptor(res: Observable < any >): Observable < any > | void {
        if (this.rebirthHttpProvider) {
            return this.rebirthHttpProvider.handleResponse(res);
        }

        return res;
    }

}

export function BaseUrl(url: string) {
    return function <TFunction extends Function>(target: TFunction): TFunction {
        target.prototype.getBaseUrl = function () {
            return url;
        };
        return target;
    };
}

export function DefaultHeaders(headers: any) {
    return function <TFunction extends Function>(target: TFunction): TFunction {
        target.prototype.getDefaultHeaders = function () {
            return headers;
        };
        return target;
    };
}

function paramBuilder(paramName: string, optional = false) {
    return function (key?: string) {
        if (!optional && !key) {
            throw new Error(`${paramName} Key is required!`);
        }
        return function (target: RebirthHttp, propertyKey: string | symbol, parameterIndex: number) {
            let metadataKey = `${propertyKey}_${paramName}_parameters`;
            let paramObj: any = {
                key: key,
                parameterIndex: parameterIndex
            };
            if (Array.isArray(target[metadataKey])) {
                target[metadataKey].push(paramObj);
            } else {
                target[metadataKey] = [paramObj];
            }
        };
    };
}

export var Path = paramBuilder("Path");

export var Query = paramBuilder("Query", true);

export var Body = paramBuilder("Body")("Body");

export var Header = paramBuilder("Header");

export function Headers(headersDef: any) {
    return function (target: RebirthHttp, propertyKey: string, descriptor: any) {
        descriptor.headers = headersDef;
        return descriptor;
    };
}

export function Produces(producesDef: string) {
    return function (target: RebirthHttp, propertyKey: string, descriptor: any) {
        descriptor.enableJson = producesDef.toLocaleLowerCase() === 'json';
        return descriptor;
    };
}


function methodBuilder(method: number, isJsonp = false) {
    return function (url: string) {
        return function (target: RebirthHttp, propertyKey: string, descriptor: any) {

            let pPath = target[`${propertyKey}_Path_parameters`];
            let pQuery = target[`${propertyKey}_Query_parameters`];
            let pBody = target[`${propertyKey}_Body_parameters`];
            let pHeader = target[`${propertyKey}_Header_parameters`];

            descriptor.value = function (...args: any[]) {

                // Body
                let body = null;
                if (pBody) {
                    let reqBody = args[pBody[0].parameterIndex];
                    body = descriptor.enableJson ? JSON.stringify(reqBody) : reqBody;
                }

                // Path
                let resUrl: string = url;
                if (pPath) {
                    for (let k in pPath) {
                        if (pPath.hasOwnProperty(k)) {
                            resUrl = resUrl.replace(`:${pPath[k].key}`, encodeURIComponent(args[pPath[k].parameterIndex]));
                        }
                    }
                }

                // Query
                let search = new URLSearchParams();
                if (pQuery) {
                    pQuery
                        .filter(p => args[p.parameterIndex]) // filter out optional parameters
                        .forEach(p => {
                            let key = p.key;
                            let value = args[p.parameterIndex];

                            if (value instanceof Date) {
                                search.set(encodeURIComponent(key), encodeURIComponent((<Date>value).getTime().toString()));
                            } else if (isObject(value)) {
                                for (let k in value) {
                                    if (value.hasOwnProperty(k)) {
                                        search.set(encodeURIComponent(k), encodeURIComponent(value[k]));
                                    }
                                }
                            } else {
                                search.set(encodeURIComponent(key), encodeURIComponent((value || '').toString()));
                            }
                        });
                }

                // Headers
                // set class default headers
                let headers = new ngHeaders(this.getDefaultHeaders());
                // set method specific headers
                for (let k in descriptor.headers) {
                    if (descriptor.headers.hasOwnProperty(k)) {
                        headers.append(k, descriptor.headers[k]);
                    }
                }

                if (pHeader) {
                    for (let k in pHeader) {
                        if (pHeader.hasOwnProperty(k)) {
                            headers.append(pHeader[k].key, args[pHeader[k].parameterIndex]);
                        }
                    }
                }

                let baseUrl = this.getBaseUrl();
                let host = baseUrl ? baseUrl.replace(/\/$/, "") + '/' : '';
                let options = new RequestOptions({
                    method,
                    url: `${host}${resUrl.replace(/^\//, "")}`,
                    headers,
                    body,
                    search
                });

                options = this.requestInterceptor(options) || options;
                let httpRequest = isJsonp ? this.jsonp : this.http;
                if (!httpRequest) {
                    throw 'Http or jsonp should at less passs one of them!';
                }
                let observable: Observable<Response> = httpRequest.request(new Request(options));
                // @Produces
                if (descriptor.enableJson) {
                    observable = observable.map(res => res.json());
                }
                return this.responseInterceptor(observable) || observable;
            };

            return descriptor;
        };
    };
}

export var GET = methodBuilder(RequestMethod.Get);

export var JSONP = methodBuilder(RequestMethod.Get, true);

export var POST = methodBuilder(RequestMethod.Post);

export var PUT = methodBuilder(RequestMethod.Put);

export var DELETE = methodBuilder(RequestMethod.Delete);

export var HEAD = methodBuilder(RequestMethod.Head);


export const REBIRTH_HTTP_PROVIDERS: Array<any> = [
    RebirthHttpProvider
];

