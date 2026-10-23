export interface InterceptionContract {
  readonly siteId:string;
  /** Return only text the user has already authorized this adapter to observe. */
  subscribe(onText:(messageId:string,revision:string,content:string)=>void):()=>void;
}
export function createUnconfiguredInterception():InterceptionContract {
  return {siteId:'unconfigured',subscribe(){throw new Error('站点拦截尚未实现或授权');}};
}
