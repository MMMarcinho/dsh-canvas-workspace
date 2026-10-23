import * as acorn from 'acorn';
import type { Document, HostAction, HostAdapter, Value } from './types.js';
import { limits } from './types.js';

type Env = Record<string, unknown>;
type Closure = { $closure: true; node: any; env: Env };
type Setter = { $setter: string };
type Action = { $action: 'copy' | 'issueNewTurn' };
const forbidden = new Set(['__proto__','prototype','constructor','caller','callee','arguments','window','globalThis','document','self','top','parent','Function','eval','fetch','XMLHttpRequest']);
// A declared local may share a name with a browser global; property and prototype access stays blocked.
const shadowableHostGlobals = new Set(['window','globalThis','document','self','top','parent']);
function keyOf(value:unknown):string {const key=String(value);if(forbidden.has(key))throw new Error(`blocked property: ${key}`);return key;}
function own(obj:unknown,key:string):unknown {if(obj==null)return undefined;if(typeof obj==='string'){if(key==='length')return obj.length;if(/^\d+$/.test(key))return obj[Number(key)];return undefined;}if(Array.isArray(obj)){if(key==='length')return obj.length;if(/^\d+$/.test(key))return obj[Number(key)];return undefined;}if(typeof obj==='object'&&Object.prototype.hasOwnProperty.call(obj,key))return (obj as Env)[key];return undefined;}
const finite=(x:unknown)=>{const n=Number(x);return Number.isFinite(n)?n:0;};
const bounded=(s:string)=>{if(s.length>limits.stringLength)throw new Error('string budget exceeded');return s;};
export class SafeEvaluator {
  steps=0;
  constructor(readonly hooks?:{set?:(name:string,value:unknown)=>void; action?:(kind:'copy'|'issueNewTurn',payload:string)=>void}){}
  parse(source:string):any {if(source.length>limits.stringLength)throw new Error('expression source budget exceeded');const ast=acorn.parseExpressionAt(source,0,{ecmaVersion:'latest'} as any);if(source.slice(ast.end).trim())throw new Error('unexpected expression suffix');return ast;}
  evaluate(source:string,env:Env={}):unknown {this.steps=0;return this.run(this.parse(source),env,0);}
  execute(source:string,env:Env={},input?:unknown):unknown {this.steps=0;const ast=this.parse(source);const result=this.run(ast,env,0);if(result&&typeof result==='object'&&'$closure' in result)return this.invoke(result as Closure,[input],1);if(result&&typeof result==='object'&&'$setter' in result){this.hooks?.set?.((result as Setter).$setter,input);return undefined;}return result;}
  private invoke(fn:Closure,args:unknown[],depth:number):unknown {const local={...fn.env};fn.node.params.forEach((p:any,i:number)=>{if(p.type!=='Identifier')throw new Error('only named arrow parameters');local[p.name]=args[i];});return this.run(fn.node.body,local,depth);}
  private run(n:any,env:Env,depth:number):unknown {
    if(++this.steps>limits.expressionSteps||depth>limits.depth)throw new Error('expression budget exceeded');
    const go=(x:any)=>this.run(x,env,depth+1);
    switch(n.type){
      case 'Literal':return n.value;
      case 'Identifier':{const local=Object.prototype.hasOwnProperty.call(env,n.name);if(forbidden.has(n.name)&&(!local||!shadowableHostGlobals.has(n.name)))throw new Error(`blocked identifier: ${n.name}`);return local?env[n.name]:undefined;}
      case 'ArrayExpression':{if(n.elements.length>limits.arrayItems)throw new Error('array budget exceeded');const out:unknown[]=[];for(const e of n.elements){if(!e){out.push(null);continue;}if(e.type==='SpreadElement'){const v=go(e.argument);if(!Array.isArray(v))throw new Error('array spread requires array');out.push(...v);}else out.push(go(e));}if(out.length>limits.arrayItems)throw new Error('array budget exceeded');return out;}
      case 'ObjectExpression':{const out:Env=Object.create(null);for(const p of n.properties){if(p.type==='SpreadElement'){const v=go(p.argument);if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('object spread requires object');for(const [k,x] of Object.entries(v))out[keyOf(k)]=x;continue;}if(p.kind!=='init'||p.method)throw new Error('object method forbidden');const k=keyOf(p.computed?go(p.key):(p.key.name??p.key.value));out[k]=go(p.value);}return out;}
      case 'UnaryExpression':{const v=go(n.argument);if(n.operator==='!')return !v;if(n.operator==='+')return +finite(v);if(n.operator==='-')return -finite(v);if(n.operator==='typeof')return typeof v;throw new Error('unary operator forbidden');}
      case 'BinaryExpression':{const a=go(n.left),b=go(n.right);switch(n.operator){case '+':return typeof a==='string'||typeof b==='string'?bounded(String(a)+String(b)):finite(a)+finite(b);case '-':return finite(a)-finite(b);case '*':return finite(a)*finite(b);case '/':return finite(a)/finite(b);case '%':return finite(a)%finite(b);case '**':return finite(a)**finite(b);case '===':return a===b;case '!==':return a!==b;case '==':return a==b;case '!=':return a!=b;case '<':return (a as number)<(b as number);case '<=':return (a as number)<=(b as number);case '>':return (a as number)>(b as number);case '>=':return (a as number)>=(b as number);default:throw new Error('binary operator forbidden');}}
      case 'LogicalExpression':{const a=go(n.left);return n.operator==='&&'?(a?go(n.right):a):n.operator==='||'?(a?a:go(n.right)):n.operator==='??'?(a??go(n.right)):(()=>{throw new Error('logical operator forbidden')})();}
      case 'ConditionalExpression':return go(n.test)?go(n.consequent):go(n.alternate);
      case 'MemberExpression':{const obj=go(n.object),key=keyOf(n.computed?go(n.property):n.property.name);return own(obj,key);}
      case 'ChainExpression':throw new Error('optional chaining not supported');
      case 'ArrowFunctionExpression':return {$closure:true,node:n,env:{...env}} as Closure;
      case 'TemplateLiteral':{let s='';for(let i=0;i<n.quasis.length;i++){s+=n.quasis[i].value.cooked??'';if(i<n.expressions.length)s+=String(go(n.expressions[i])??'');}if(s.length>limits.stringLength)throw new Error('string budget exceeded');return s;}
      case 'SequenceExpression':{let v:unknown;for(const x of n.expressions)v=go(x);return v;}
      case 'BlockStatement':{let v:unknown;for(const x of n.body){if(x.type!=='ExpressionStatement')throw new Error('only expression statements in action');v=go(x.expression);}return v;}
      case 'CallExpression':{
        const args=n.arguments.map((a:any)=>{if(a.type==='SpreadElement')throw new Error('call spread forbidden');return go(a);});
        if(n.callee.type==='Identifier'){
          const id=n.callee.name,v=env[id];if(v&&typeof v==='object'&&'$setter' in v){if(!this.hooks?.set)throw new Error('setter unavailable');const x=args[0];this.hooks.set((v as Setter).$setter,x&&typeof x==='object'&&'$closure' in x?this.invoke(x as Closure,[(env.__currentState as Env)?.[(v as Setter).$setter]],depth+1):x);return undefined;}
          if(id==='Number')return finite(args[0]);if(id==='String')return bounded(String(args[0]??''));throw new Error(`call forbidden: ${id}`);
        }
        if(n.callee.type!=='MemberExpression')throw new Error('call target forbidden');
        const obj=go(n.callee.object),key=keyOf(n.callee.computed?go(n.callee.property):n.callee.property.name);
        if(obj&&typeof obj==='object'&&'$action' in obj){if(key!=='call')throw new Error('action member forbidden');}
        if(n.callee.object.type==='Identifier'&&n.callee.object.name==='Math'){const allowed:Record<string,(...n:number[])=>number>={max:Math.max,min:Math.min,round:Math.round,floor:Math.floor,ceil:Math.ceil,abs:Math.abs};if(!allowed[key])throw new Error('Math method forbidden');return allowed[key](...args.map(finite));}
        if(n.callee.object.type==='Identifier'&&n.callee.object.name==='JSON'){if(key!=='stringify')throw new Error('JSON method forbidden');const s=JSON.stringify(args[0],null,Math.min(4,finite(args[2])));if(s?.length>limits.stringLength)throw new Error('string budget exceeded');return s;}
        if(n.callee.object.type==='Identifier'&&n.callee.object.name==='GenUI'){if(key!=='copy'&&key!=='issueNewTurn')throw new Error('host action forbidden');const payload=String(args[0]??'');if(payload.length>limits.actionLength)throw new Error('action length exceeded');this.hooks?.action?.(key,payload);return undefined;}
        if(Array.isArray(obj)){
          if(key==='includes')return obj.includes(args[0]);if(key==='join')return bounded(obj.join(String(args[0]??',')));if(key==='slice')return obj.slice(finite(args[0]),args[1]===undefined?undefined:finite(args[1]));
          if(['map','filter','find','sort'].includes(key)){const fn=args[0] as Closure;if(!fn||typeof fn!=='object'||!('$closure' in fn))throw new Error('array callback must be arrow');const arr=obj.slice(0,limits.arrayItems);if(key==='map')return arr.map((x,i)=>this.invoke(fn,[x,i],depth+1));if(key==='filter')return arr.filter((x,i)=>this.invoke(fn,[x,i],depth+1));if(key==='find')return arr.find((x,i)=>this.invoke(fn,[x,i],depth+1));return arr.sort((a,b)=>finite(this.invoke(fn,[a,b],depth+1)));}
          throw new Error('array method forbidden');
        }
        if(typeof obj==='string'){if(key==='toString')return obj;if(key==='includes')return obj.includes(String(args[0]));/* Canvas patch: primitive, bounded, pure slice only; no prototype dispatch. */if(key==='slice')return bounded(obj.slice(finite(args[0]),args[1]===undefined?undefined:finite(args[1])));throw new Error('string method forbidden');}
        if(typeof obj==='number'){if(key==='toFixed')return obj.toFixed(Math.min(6,Math.max(0,finite(args[0]))));if(key==='toLocaleString')return obj.toLocaleString(args[0]===undefined?'en-US':String(args[0]),{maximumFractionDigits:Math.min(6,finite((args[1] as Env)?.maximumFractionDigits??3))});throw new Error('number method forbidden');}
        throw new Error('member call forbidden');
      }
      default:throw new Error(`syntax forbidden: ${n.type}`);
    }
  }
}
export class Runtime {
  readonly state=new Map<string,unknown>();readonly feedback:string[]=[];private eventNumber=0;private actionIds=new Set<string>();private setters=new Map<string,string>();
  constructor(public document:Document,readonly adapter:HostAdapter={}){}
  private note(message:string){this.feedback.push(message);if(this.feedback.length>20)this.feedback.shift();}
  update(document:Document){if(document.messageId!==this.document.messageId){this.state.clear();this.actionIds.clear();}this.document=document;this.setters.clear();}
  reset(){this.state.clear();this.feedback.length=0;this.actionIds.clear();}
  scope():Env{
    const env:Env={Math:Object.freeze({}),JSON:Object.freeze({}),GenUI:Object.freeze({})};
    const evaluator=new SafeEvaluator();this.setters.clear();
    for(const d of this.document.declarations){try{if(d.state){if(!this.state.has(d.name))this.state.set(d.name,evaluator.evaluate(d.expression,env));env[d.name]=this.state.get(d.name);if(d.setter){this.setters.set(d.setter,d.name);env[d.setter]={$setter:d.name};}}else env[d.name]=evaluator.evaluate(d.expression,env);}catch(e){this.note(`${d.name}: ${String(e)}`);}}
    env.__currentState=Object.fromEntries(this.state);return env;
  }
  value(source:string,env:Env=this.scope()):unknown{return new SafeEvaluator().evaluate(source,env);}
  async event(source:string,input?:unknown,env:Env=this.scope()):Promise<void>{
    const eventId=++this.eventNumber,actions:HostAction[]=[];
    const evaluator=new SafeEvaluator({set:(name,value)=>{this.state.set(name,value);env[name]=value;(env.__currentState as Env)[name]=value;},action:(kind,payload)=>actions.push({kind,payload,id:`${this.document.messageId}:${eventId}:${actions.length}`,messageId:this.document.messageId})});
    try{evaluator.execute(source,env,input);}catch(e){this.note(`事件错误: ${String(e)}`);return;}
    for(const action of actions){if(this.actionIds.has(action.id))continue;this.actionIds.add(action.id);if(!this.adapter.requestAction){this.note(`${action.kind}: 宿主未配置`);continue;}try{const result=await this.adapter.requestAction(action);this.note(result.message||`${action.kind}: ${result.ok?'已执行':'未执行'}`);}catch(e){this.note(`${action.kind}: ${String(e)}`);}}
  }
}
export function toValue(v:unknown):Value {return JSON.parse(JSON.stringify(v??null)) as Value;}
