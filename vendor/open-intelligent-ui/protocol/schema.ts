import type { Document, Node } from './types.js';
import { componentNames } from './registry.js';
export const documentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.invalid/iui/0.1/document.schema.json',
  title: 'Intelligent UI Protocol v0.1',
  type: 'object', required: ['protocol', 'messageId', 'declarations', 'children', 'diagnostics', 'complete'],
  additionalProperties: false,
  properties: {
    protocol: { const: 'iui/0.1' }, messageId: { type: 'string', minLength: 1 },
    declarations: { type: 'array', items: { type: 'object', required: ['name','expression','state','span'], properties: { name: { type:'string' }, setter:{type:'string'}, expression:{type:'string'},state:{type:'boolean'},span:{$ref:'#/$defs/span'} } } },
    children: { type:'array', items:{$ref:'#/$defs/node'} }, diagnostics:{type:'array'}, complete:{type:'boolean'}
  },
  $defs: {
    span:{type:'object',required:['start','end'],properties:{start:{type:'integer',minimum:0},end:{type:'integer',minimum:0}}},
    node:{oneOf:[
      {type:'object',required:['kind','text','span'],properties:{kind:{const:'text'},text:{type:'string'},span:{$ref:'#/$defs/span'}}},
      {type:'object',required:['kind','source','span'],properties:{kind:{const:'expression'},source:{type:'string'},span:{$ref:'#/$defs/span'}}},
      {type:'object',required:['kind','name','attributes','children','span'],properties:{kind:{const:'element'},name:{type:'string',enum:[...componentNames]},attributes:{type:'object'},children:{type:'array',items:{$ref:'#/$defs/node'}},rawContent:{type:'string',maxLength:32000},span:{$ref:'#/$defs/span'}}},
      {type:'object',required:['kind','test','children','span'],properties:{kind:{const:'if'},test:{type:'string'},children:{type:'array',items:{$ref:'#/$defs/node'}},span:{$ref:'#/$defs/span'}}},
      {type:'object',required:['kind','source','item','children','span'],properties:{kind:{const:'each'},source:{type:'string'},item:{type:'string'},index:{type:'string'},children:{type:'array',items:{$ref:'#/$defs/node'}},span:{$ref:'#/$defs/span'}}}
    ]}
  }
} as const;
export function validateDocument(value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok:false, errors:['document must be an object'] };
  const d=value as Partial<Document>;
  if (d.protocol !== 'iui/0.1') errors.push('protocol must be iui/0.1');
  if (typeof d.messageId !== 'string' || !d.messageId) errors.push('messageId required');
  if (!Array.isArray(d.declarations)) errors.push('declarations array required');
  if (!Array.isArray(d.children)) errors.push('children array required');
  if (!Array.isArray(d.diagnostics)) errors.push('diagnostics array required');
  if (typeof d.complete!=='boolean') errors.push('complete boolean required');
  const span=(x:unknown)=>!!x&&typeof x==='object'&&Number.isInteger((x as any).start)&&Number.isInteger((x as any).end)&&(x as any).start>=0&&(x as any).end>=-1;
  if(Array.isArray(d.declarations))for(const x of d.declarations){if(typeof x.name!=='string'||typeof x.expression!=='string'||typeof x.state!=='boolean'||!span(x.span))errors.push('invalid declaration');}
  const walk=(nodes:Node[],depth:number)=>{ if(depth>32){errors.push('depth budget exceeded');return;} for(const n of nodes){if(!n || typeof n!=='object' || !('kind' in n)){errors.push('invalid node');continue;}if(!span(n.span))errors.push('invalid span');if(n.kind==='element'){if(!componentNames.has(n.name)) errors.push(`unknown component ${n.name}`);if(!n.attributes||typeof n.attributes!=='object')errors.push('invalid attributes');else for(const a of Object.values(n.attributes)){if(!a||!['literal','expression'].includes(a.kind)||!span(a.span))errors.push('invalid attribute');}if(n.rawContent!==undefined&&(!['AppBlock','CodeBlock','WritingBlock'].includes(n.name)||typeof n.rawContent!=='string'||new TextEncoder().encode(n.rawContent).length>32_000))errors.push('invalid raw content');if(!Array.isArray(n.children))errors.push('invalid children');else walk(n.children,depth+1);} else if(n.kind==='if'||n.kind==='each'){if(!Array.isArray(n.children))errors.push('invalid children');else walk(n.children,depth+1);} else if(n.kind!=='text'&&n.kind!=='expression')errors.push('unknown node kind');}};
  if(Array.isArray(d.children))walk(d.children,0);
  return {ok:errors.length===0,errors};
}
