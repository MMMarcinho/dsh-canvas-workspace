import { componentNames } from './registry.js';
import { limits, type Attribute, type Declaration, type Diagnostic, type Document, type Node } from './types.js';

/** Decode only the transport wrapper identified by the caller; never infer or chain decoders. */
export function decodeCapturedText(source:string,wrapper:'plain'|'json-string'='plain'):string {
  if(wrapper==='plain')return source;
  const decoded:unknown=JSON.parse(source.trim());
  if(typeof decoded!=='string')throw new Error('capture wrapper must contain a string');
  return decoded;
}

function balanced(source:string,start:number,open='{',close='}'):number {
  let depth=0,quote='';
  for(let i=start;i<source.length;i++){
    const c=source[i];
    if(quote){if(c==='\\'){i++;continue;} if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c===open)depth++;
    if(c===close&&--depth===0)return i+1;
  }
  return -1;
}
function tagEnd(source:string,start:number):number {
  let quote='',braces=0;
  for(let i=start;i<source.length;i++){
    const c=source[i];
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')braces++;else if(c==='}')braces--;
    else if(c==='>'&&braces===0)return i+1;
  }
  return -1;
}
/** Keep foreign HTML/XML elements opaque, including any UI-looking text inside them. */
function opaqueEnd(source:string,openingEnd:number,name:string):number {
  let depth=1,pos=openingEnd;
  const pattern=new RegExp(`^<(/?)${name}(?=[\\s/>])`);
  while(pos<source.length){
    const next=source.indexOf('<',pos);if(next<0)return source.length;
    const match=pattern.exec(source.slice(next));if(!match){pos=next+1;continue;}
    const end=tagEnd(source,next);if(end<0)return source.length;
    const self=/\/\s*>$/.test(source.slice(next,end));
    if(match[1])depth--;else if(!self)depth++;
    if(depth===0)return end;
    pos=end;
  }
  return source.length;
}
/** Raw blocks reserve a standalone closing line, so code/HTML braces remain opaque. */
function rawBlockClose(source:string,openingEnd:number,name:'AppBlock'|'CodeBlock'|'WritingBlock'):{start:number;end:number}|null {
  const pattern=new RegExp(`(?:^|\\n)[ \\t]*<\\/${name}>[ \\t]*(?=\\r?\\n|$)`,'g');
  pattern.lastIndex=openingEnd;
  const match=pattern.exec(source);
  if(!match)return null;
  const start=match.index+(match[0].startsWith('\n')?1:0);
  return {start,end:match.index+match[0].length};
}
/** Canvas patch: Markdown fences require matching marker runs and a closing line. */
function fencedCodeEnd(source:string,start:number):number|null {
  const lineStart=source.lastIndexOf('\n',start-1)+1;
  if(!/^ {0,3}$/.test(source.slice(lineStart,start)))return null;
  const marker=source[start];if(marker!=='`'&&marker!=='~')return null;
  let length=0;while(source[start+length]===marker)length++;
  if(length<3)return null;
  const openingEnd=source.indexOf('\n',start+length);
  if(openingEnd<0)return source.length;
  if(marker==='`'&&source.slice(start+length,openingEnd).includes('`'))return null;
  let pos=openingEnd+1;
  while(pos<source.length){
    const newline=source.indexOf('\n',pos),end=newline<0?source.length:newline;
    const line=source.slice(pos,end).replace(/\r$/,'');
    const indent=/^ {0,3}/.exec(line)![0].length;
    let run=0;while(line[indent+run]===marker)run++;
    if(run>=length&&/^[ \t]*$/.test(line.slice(indent+run)))return end;
    if(newline<0)break;pos=newline+1;
  }
  return source.length;
}
/** Inline code also closes only on a backtick run of exactly the opening length. */
function inlineCodeEnd(source:string,start:number):number {
  let length=1;while(source[start+length]==='`')length++;
  let pos=start+length;
  while(pos<source.length){
    const next=source.indexOf('`',pos);if(next<0)return source.length;
    let run=1;while(source[next+run]==='`')run++;
    if(run===length)return next+run;pos=next+run;
  }
  return source.length;
}
function parseAttributes(s:string,base:number,diagnostics:Diagnostic[]):Record<string,Attribute>{
  const result:Record<string,Attribute>={};let i=0;
  while(i<s.length){while(/\s/.test(s[i]||''))i++;if(i>=s.length)break;
    const start=i,m=/^[\w-]+/.exec(s.slice(i));if(!m){diagnostics.push({code:'attribute_syntax',message:'无效属性',span:{start:base+i,end:base+i+1},severity:'error'});i++;continue;}
    const name=m[0];i+=name.length;while(/\s/.test(s[i]||''))i++;
    let value:Attribute={kind:'literal',value:true,span:{start:base+start,end:base+i}};
    if(s[i]==='='){
      i++;while(/\s/.test(s[i]||''))i++;
      if(s[i]==='{'){const end=balanced(s,i);if(end<0){diagnostics.push({code:'incomplete_attribute',message:`属性 ${name} 表达式未结束`,span:{start:base+i,end:base+s.length},severity:'error'});break;} value={kind:'expression',value:s.slice(i+1,end-1),span:{start:base+i,end:base+end}};i=end;}
      else if(s[i]==='"'||s[i]==="'"){const q=s[i++],v=i;while(i<s.length&&s[i]!==q){if(s[i]==='\\')i++;i++;}value={kind:'literal',value:s.slice(v,i),span:{start:base+v,end:base+i}};i++;}
      else {const v=i;while(i<s.length&&!/\s/.test(s[i]))i++;value={kind:'literal',value:s.slice(v,i),span:{start:base+v,end:base+i}};}
    }
    result[name]=value;
  }
  return result;
}
function declaration(raw:string,start:number,end:number,diagnostics:Diagnostic[]):Declaration|null{
  const s=raw.trim();
  const state=/^const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*DIL\.useState\(([\s\S]*)\)$/.exec(s);
  if(state)return {name:state[1],setter:state[2],expression:state[3],state:true,span:{start,end}};
  const derived=/^const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(s);
  if(derived)return {name:derived[1],expression:derived[2],state:false,span:{start,end}};
  diagnostics.push({code:'body_syntax',message:'仅允许 const 派生值或 DIL.useState 声明',span:{start,end},severity:'error'});return null;
}
function committed(nodes:Node[],openContainers=false):Node[]{
  const result:Node[]=[];
  for(const n of nodes){
    if(n.kind==='element'||n.kind==='if'||n.kind==='each'){
      const children=committed(n.children,openContainers);
      if(n.span.end>=0)result.push({...n,children});
      else if(openContainers&&children.length)result.push({...n,children});
    }else if(n.span.end>=0)result.push(n);
  }
  return result;
}
export function parseDsl(source:string,messageId='preview',final=true,openContainers=false):Document{
  const diagnostics:Diagnostic[]=[],declarations:Declaration[]=[],children:Node[]=[];
  if(new TextEncoder().encode(source).length>limits.sourceBytes){return {protocol:'iui/0.1',messageId,declarations,children,diagnostics:[{code:'source_budget',message:'输入超过 200 KB',span:{start:0,end:source.length},severity:'error'}],complete:false};}
  const stack:{name:string;node:Node&{children:Node[]}}[]=[];
  let target=children,i=0,textStart=0,count=0;
  const flush=(end:number)=>{if(end>textStart)target.push({kind:'text',text:source.slice(textStart,end),span:{start:textStart,end}});textStart=end;};
  const add=(node:Node)=>{if(++count>limits.nodes)throw new Error('node budget exceeded');target.push(node);};
  try {while(i<source.length){
    if(source.startsWith('<!--',i)){const close=source.indexOf('-->',i+4);i=close<0?source.length:close+3;continue;}
    // Top-level indented Markdown code is opaque. Indentation inside a real
    // IUI container remains component formatting, not a second parser language.
    if(stack.length===0&&(i===0||source[i-1]==='\n')&&/^(?: {4}| {0,3}\t)/.test(source.slice(i))){
      const newline=source.indexOf('\n',i);i=newline<0?source.length:newline+1;continue;
    }
    if(source.startsWith('```',i)||source.startsWith('~~~',i)){
      const end=fencedCodeEnd(source,i);if(end!==null){i=end;continue;}
    }
    if(source[i]==='`'){i=inlineCodeEnd(source,i);continue;}
    if(source[i]==='\\'&&source[i+1]==='<'){
      const match=/^<([A-Za-z][\w-]*)/.exec(source.slice(i+1));
      if(match){const end=tagEnd(source,i+1);if(end>0){i=/\/\s*>$/.test(source.slice(i+1,end))?end:opaqueEnd(source,end,match[1]);continue;}}
      i+=2;continue;
    }
    if(source[i]==='\\'&&source[i+1]==='{'){i+=2;continue;}
    if(source.startsWith('{@body',i)){
      const end=balanced(source,i);if(end<0){diagnostics.push({code:'incomplete_body',message:'状态声明未结束',span:{start:i,end:source.length},severity:openContainers?'warning':'error'});break;}
      flush(i);const d=declaration(source.slice(i+6,end-1),i,end,diagnostics);if(d)declarations.push(d);i=end;textStart=i;continue;
    }
    if(source.startsWith('{#if ',i)||source.startsWith('{#each ',i)){
      const end=balanced(source,i);if(end<0){diagnostics.push({code:'incomplete_directive',message:'控制指令未结束',span:{start:i,end:source.length},severity:openContainers?'warning':'error'});break;}
      flush(i);const raw=source.slice(i+2,end-1).trim();let node:Node|null=null;
      if(raw.startsWith('if '))node={kind:'if',test:raw.slice(3).trim(),children:[],span:{start:i,end:-1}};
      else {const m=/^each\s+([\s\S]+)\s+as\s+([\w$]+)(?:\s*,\s*([\w$]+))?$/.exec(raw);if(m)node={kind:'each',source:m[1],item:m[2],index:m[3],children:[],span:{start:i,end:-1}};}
      if(node){add(node);stack.push({name:node.kind,node:node as Node&{children:Node[]}});target=node.children;}
      else diagnostics.push({code:'directive_syntax',message:'无效循环或条件指令',span:{start:i,end},severity:'error'});
      i=end;textStart=i;continue;
    }
    if(source.startsWith('{/if}',i)||source.startsWith('{/each}',i)){
      const name=source.startsWith('{/if}',i)?'if':'each',end=i+name.length+3;flush(i);
      if(stack.at(-1)?.name===name){const entry=stack.pop()!;entry.node.span.end=end;target=stack.at(-1)?.node.children||children;}
      else diagnostics.push({code:'mismatched_close',message:`意外的 ${name} 结束指令`,span:{start:i,end},severity:'error'});
      i=end;textStart=i;continue;
    }
    if(source[i]==='<'&&/^<\/?[A-Za-z][\w-]*/.test(source.slice(i))){
      const end=tagEnd(source,i);if(end<0){diagnostics.push({code:'incomplete_tag',message:'标签未结束',span:{start:i,end:source.length},severity:openContainers?'warning':'error'});break;}
      const raw=source.slice(i+1,end-1),close=raw.startsWith('/'),name=/^\/?([A-Za-z][\w-]*)/.exec(raw)?.[1]||'';
      if(!componentNames.has(name)){
        i=!close&&!/\/\s*$/.test(raw)?opaqueEnd(source,end,name):end;
        continue;
      }
      flush(i);
      if((name==='AppBlock'||name==='CodeBlock'||name==='WritingBlock')&&!close){
        const attrs=parseAttributes(raw.slice(name.length),i+1+name.length,diagnostics);
        if(name==='AppBlock'){
          const invalid=Object.entries(attrs).some(([key,value])=>!['title','icon','variant','app_block_id'].includes(key)||value.kind!=='literal'||typeof value.value!=='string');
          if(invalid)diagnostics.push({code:'app_block_attribute',message:'AppBlock 只接受 title、icon、variant、app_block_id 字符串属性',span:{start:i,end},severity:'error'});
        }else if(Object.values(attrs).some(value=>value.kind==='expression'))diagnostics.push({code:'raw_block_attribute',message:`${name} 不接受表达式属性`,span:{start:i,end},severity:'error'});
        const closing=rawBlockClose(source,end,name);
        if(!closing){diagnostics.push({code:'incomplete_raw_block',message:`${name} 缺少独占一行的 </${name}>`,span:{start:i,end:source.length},severity:final?'error':'warning'});i=source.length;textStart=i;break;}
        const content=source.slice(end,closing.start);
        if(new TextEncoder().encode(content).length>32_000)diagnostics.push({code:'raw_block_budget',message:`${name} 内容超过 32 KB`,span:{start:end,end:closing.start},severity:'error'});
        add({kind:'element',name,attributes:attrs,children:[],rawContent:content,span:{start:i,end:closing.end}});
        i=closing.end;textStart=i;continue;
      }
      if(close){if(stack.at(-1)?.name===name){const entry=stack.pop()!;entry.node.span.end=end;target=stack.at(-1)?.node.children||children;}else diagnostics.push({code:'mismatched_close',message:`结束标签 </${name}> 不匹配`,span:{start:i,end},severity:'error'});}
      else {const self=/\/\s*$/.test(raw),attrs=raw.slice(name.length,self?raw.lastIndexOf('/'):undefined);const node:Node={kind:'element',name,attributes:parseAttributes(attrs,i+1+name.length,diagnostics),children:[],span:{start:i,end:self?end:-1}};add(node);if(!self){if(stack.length>=limits.depth){diagnostics.push({code:'depth_budget',message:'嵌套超过 32 层',span:{start:i,end},severity:'error'});node.span.end=end;}else{stack.push({name,node});target=node.children;}}}
      i=end;textStart=i;continue;
    }
    if(stack.length>0&&source[i]==='{'&&!source.startsWith('{@',i)&&!source.startsWith('{#',i)){
      const end=balanced(source,i);if(end>i+2){const expr=source.slice(i+1,end-1).trim();if(expr&&!expr.startsWith('/')){flush(i);add({kind:'expression',source:expr,span:{start:i,end}});i=end;textStart=i;continue;}}
      if(openContainers&&end<0){diagnostics.push({code:'incomplete_expression',message:'表达式未结束',span:{start:i,end:source.length},severity:'warning'});break;}
    }
    if(openContainers&&source[i]==='{'&&balanced(source,i)<0){diagnostics.push({code:'incomplete_expression',message:'结构未结束',span:{start:i,end:source.length},severity:'warning'});break;}
    if(openContainers&&(source.slice(i)==='<'||source.slice(i)==='</')){diagnostics.push({code:'incomplete_tag',message:'标签未结束',span:{start:i,end:source.length},severity:'warning'});break;}
    i++;
  }}catch(e){diagnostics.push({code:'resource_budget',message:String(e),span:{start:i,end:i},severity:'error'});}
  flush(i);
  if(i<source.length&&final){target.push({kind:'text',text:source.slice(i),span:{start:i,end:source.length}});}
  for(const entry of stack){diagnostics.push({code:'unclosed_tag',message:`未闭合 ${entry.name}`,span:{start:entry.node.span.start,end:source.length},severity:final?'error':'warning'});if(final)entry.node.span.end=source.length;}
  return {protocol:'iui/0.1',messageId,declarations,children:final?children:committed(children,openContainers),diagnostics,complete:final&&diagnostics.every(d=>d.severity!=='error')};
}
/** Preview only complete syntax and text inside open containers; never synthesize a closing token. */
export function parseDslPreview(source:string,messageId='preview'):Document{return parseDsl(source,messageId,false,true);}
export class StreamParser {
  private source=''; constructor(readonly messageId:string){}
  append(chunk:string,final=false):Document{this.source+=chunk;return parseDsl(this.source,this.messageId,final);}
  reset(){this.source='';}
  get text(){return this.source;}
}
