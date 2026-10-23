import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ThemeProvider, type ThemeMode } from '../theme/index.js';
import { byName, safeColor, safeCssSize, type Attribute, type Node, type Runtime } from '../../protocol/index.js';
import { Text, Title, Caption, Badge, Code, MathText, Label, Bold, Italic, Underline, Strikethrough, Icon, Blockquote, CodeBlock } from '../components/text/index.js';
import { Box, Row, Column, Flow, Card, Grid, GridItem, FlowItem, CarouselItem, Divider, Spacer, Table, TableRow, TableCell, List, ListItem, Popover, PopoverTrigger, PopoverContent, Carousel } from '../components/layout/index.js';
import { Button, Pressable, Input, Textarea, Select, Checkbox, RadioGroup, Radio, Slider, DatePicker, SegmentedControl, type SelectOption } from '../components/interaction/index.js';
import { Chart } from '../components/visualization/index.js';
import { AppBlock, AsyncImage, AsyncImageGroup, UnconfiguredHost, UnsupportedComponent } from '../components/media/index.js';
import { renderMarkdownText } from './markdown.js';

type Props={runtime:Runtime;showPlainText?:boolean;targets?:HTMLElement[];themeMode?:ThemeMode};
type Scope=Record<string,unknown>;
const get=(a:Attribute|undefined,scope:Scope,runtime:Runtime):unknown=>{if(!a)return undefined;if(a.kind==='literal')return a.value;try{return runtime.value(String(a.value),scope);}catch{return undefined;}};
const asOptions=(value:unknown):SelectOption[]=>Array.isArray(value)?value.slice(0,100).filter((x):x is {label:unknown;value:unknown}=>!!x&&typeof x==='object'&&'label'in x&&'value'in x).map(x=>({label:String(x.label),value:String(x.value)})):[];
const asNumber=(value:unknown,fallback:number)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
function resolvedStyle(read:(name:string)=>unknown):React.CSSProperties {
  const style:React.CSSProperties={};
  for(const name of ['width','height','minHeight'] as const){const size=safeCssSize(read(name));if(size)style[name]=size;}
  const background=safeColor(read('background'));if(background)style.background=background;
  const color=safeColor(read('color'));if(color)style.color=color;
  const sizes:Record<string,string>={xs:'12px',sm:'14px',md:'16px',lg:'18px',xl:'20px','2xl':'24px'};
  if(sizes[String(read('size'))])style.fontSize=sizes[String(read('size'))];
  const weights:Record<string,number>={normal:400,medium:500,semibold:600,bold:700};
  if(weights[String(read('weight'))])style.fontWeight=weights[String(read('weight'))];
  const padding=Number(read('padding'));if(Number.isFinite(padding)&&padding>=0&&padding<=8)style.padding=`calc(var(--iui-spacing) * ${padding})`;
  const gap=Number(read('gap'));if(Number.isFinite(gap)&&gap>=0&&gap<=8)style.gap=`calc(var(--iui-spacing) * ${gap})`;
  if(read('radius'))style.borderRadius=String(read('radius'))==='full'?'999px':'var(--iui-radius)';
  if(read('border'))style.border='1px solid var(--iui-border)';
  const flex=read('flex');if(flex!==undefined&&/^\d+(?:\.\d+)?$/.test(String(flex)))style.flex=String(flex);
  const align:Record<string,React.CSSProperties['alignItems']>={center:'center',start:'flex-start',end:'flex-end'};
  const justify:Record<string,React.CSSProperties['justifyContent']>={between:'space-between',center:'center',start:'flex-start',end:'flex-end'};
  if(align[String(read('align'))])style.alignItems=align[String(read('align'))];
  if(justify[String(read('justify'))])style.justifyContent=justify[String(read('justify'))];
  if(read('wrap')==='wrap')style.flexWrap='wrap';
  const textAlign=String(read('textAlign'));if(['left','center','right','start','end'].includes(textAlign))style.textAlign=textAlign as React.CSSProperties['textAlign'];
  if(read('tabularNums'))style.fontVariantNumeric='tabular-nums';
  if(read('clip'))style.overflow='hidden';
  if(read('block'))style.width='100%';
  return style;
}
export function UIRenderer({runtime,showPlainText=false,targets,themeMode='light'}:Props){
  const [,revision]=useState(0),scope=runtime.scope();
  const force=()=>revision(v=>v+1);
  const render=(n:Node,key:React.Key,env:Scope=scope):React.ReactNode=>{
    if(n.kind==='text')return showPlainText||n.text.trim()?<React.Fragment key={key}>{renderMarkdownText(n.text)}</React.Fragment>:null;
    if(n.kind==='expression'){try{const value=runtime.value(n.source,env);return <React.Fragment key={key}>{value==null?'':String(value)}</React.Fragment>;}catch(e){return <span key={key} className="iui-error" title={String(e)}>表达式错误</span>;}}
    if(n.kind==='if'){let visible=false;try{visible=!!runtime.value(n.test,env);}catch{}return visible?<React.Fragment key={key}>{n.children.map((c,i)=>render(c,i,env))}</React.Fragment>:null;}
    if(n.kind==='each'){let values:unknown=[];try{values=runtime.value(n.source,env);}catch{}if(!Array.isArray(values))return null;return <React.Fragment key={key}>{values.slice(0,100).map((v,i)=>{const local={...env,[n.item]:v,...(n.index?{[n.index]:i}:{})};const first=n.children.find(c=>c.kind==='element'&&c.attributes.key);const stable=first?.kind==='element'?String(get(first.attributes.key,local,runtime)??i):i;return <React.Fragment key={stable}>{n.children.map((c,j)=>render(c,j,local))}</React.Fragment>;})}</React.Fragment>;}
    const name=n.name,spec=byName.get(name),p=(name:string)=>get(n.attributes[name],env,runtime),event=(name:string)=>n.attributes[name]?.kind==='expression'?String(n.attributes[name].value):undefined;
    const action=(source:string|undefined,value?:unknown)=>{if(source)void runtime.event(source,value,env).then(force);};
    if(!spec||spec.support==='unsupported')return <UnsupportedComponent key={key} name={name}/>;
    if(name==='AppBlock'){
      const literal=(key:string)=>n.attributes[key]?.kind==='literal'&&typeof n.attributes[key].value==='string'?String(n.attributes[key].value):undefined;
      return <AppBlock key={key} request={{messageId:runtime.document.messageId,id:literal('app_block_id')||'',title:literal('title'),html:n.rawContent||''}} adapter={runtime.adapter}/>;
    }
    if(name==='AsyncImage') return <AsyncImage key={key} query={p('query')} aspectRatio={p('aspectRatio')} width={p('width')}
      messageId={runtime.document.messageId} adapter={runtime.adapter}/>;
    if(name==='AsyncImageGroup') {
      return <AsyncImageGroup key={key} queries={p('query')}
        aspectRatio={p('aspectRatio')} layout={p('layout')} messageId={runtime.document.messageId} adapter={runtime.adapter}/>;
    }
    if(spec.support==='host')return <UnconfiguredHost key={key} name={name}/>;
    const kids=n.children.map((c,i)=>render(c,i,env));
    const style=resolvedStyle(p);
    switch(name){
      case 'text':return <Text key={key} style={style}>{kids}</Text>;
      case 'title':return <Title key={key} style={style}>{kids}</Title>;
      case 'caption':return <Caption key={key} style={style}>{kids}</Caption>;
      case 'badge':return <Badge key={key} style={style}>{kids}</Badge>;
      case 'code':return <Code key={key} style={style}>{kids}</Code>;
      case 'math':return <MathText key={key} style={style}>{kids}</MathText>;
      case 'label':return <Label key={key} style={style}>{kids}</Label>;
      case 'bold':return <Bold key={key} style={style}>{kids}</Bold>;
      case 'italic':return <Italic key={key} style={style}>{kids}</Italic>;
      case 'underline':return <Underline key={key} style={style}>{kids}</Underline>;
      case 'strikethrough':return <Strikethrough key={key} style={style}>{kids}</Strikethrough>;
      case 'icon':return <Icon key={key} name={String(p('name')??'icon')} style={style} inline={!!p('inline')}/>;
      case 'blockquote':return <Blockquote key={key} style={style}>{kids}</Blockquote>;
      case 'CodeBlock':return <CodeBlock key={key} style={style}>{n.rawContent??kids}</CodeBlock>;
      case 'box':return <Box key={key} style={style}>{kids}</Box>;
      case 'row':return <Row key={key} style={style}>{kids}</Row>;
      case 'col':return <Column key={key} style={style}>{kids}</Column>;
      case 'flow':return <Flow key={key} style={style}>{kids}</Flow>;
      case 'card':return <Card key={key} style={style}>{kids}</Card>;
      case 'grid':return <Grid key={key} style={style} columns={asNumber(p('columns'),2)}>{kids}</Grid>;
      case 'grid-item':return <GridItem key={key} style={style}>{kids}</GridItem>;
      case 'flow-item':return <FlowItem key={key} style={style}>{kids}</FlowItem>;
      case 'carousel-item':return <CarouselItem key={key} style={style}>{kids}</CarouselItem>;
      case 'divider':return <Divider key={key} style={style}/>;
      case 'spacer':return <Spacer key={key} style={style}/>;
      case 'table':return <Table key={key} style={style}>{kids}</Table>;
      case 'table-row':return <TableRow key={key} style={style}>{kids}</TableRow>;
      case 'table-cell':return <TableCell key={key} style={style}>{kids}</TableCell>;
      case 'list':return <List key={key} style={style} marker={String(p('marker')??'')}>{kids}</List>;
      case 'list-item':return <ListItem key={key} style={style}>{kids}</ListItem>;
      case 'popover':return <Popover key={key} style={style}>{kids}</Popover>;
      case 'popover-trigger':return <PopoverTrigger key={key}>{kids}</PopoverTrigger>;
      case 'popover-content':return <PopoverContent key={key} style={style}>{kids}</PopoverContent>;
      case 'carousel':return <Carousel key={key} style={style} activeIndex={asNumber(p('activeIndex'),0)} onChange={v=>action(event('onChange'),v)}>{kids}</Carousel>;
      case 'button':return <Button key={key} style={style} variant={String(p('variant')??'')} block={!!p('block')} disabled={!!p('disabled')} onClick={()=>action(event('onClick'))}>{kids}</Button>;
      case 'pressable':return <Pressable key={key} style={style} disabled={!!p('disabled')} onClick={()=>action(event('onClick'))}>{kids}</Pressable>;
      case 'input':return <Input key={key} style={style} value={String(p('value')??'')} placeholder={String(p('placeholder')??'')} number={p('inputType')==='number'} block={!!p('block')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'textarea':return <Textarea key={key} style={style} value={String(p('value')??'')} placeholder={String(p('placeholder')??'')} rows={asNumber(p('rows'),3)} block={!!p('block')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'select':return <Select key={key} style={style} value={String(p('value')??'')} options={asOptions(p('options'))} block={!!p('block')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'checkbox':return <Checkbox key={key} style={style} checked={!!p('checked')} lineThrough={!!p('lineThrough')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}>{kids}</Checkbox>;
      case 'radio-group':return <RadioGroup key={key} style={style} value={p('value')} direction={String(p('direction')??'row')} onChange={v=>action(event('onChange'),v)}>{kids}</RadioGroup>;
      case 'radio':return <Radio key={key} style={style} value={p('value')} disabled={!!p('disabled')}>{kids}</Radio>;
      case 'slider':return <Slider key={key} style={style} min={asNumber(p('min'),0)} max={asNumber(p('max'),100)} step={asNumber(p('step'),1)} value={asNumber(p('value'),0)} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'date-picker':return <DatePicker key={key} style={style} value={String(p('value')??'')} block={!!p('block')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'segmented-control':return <SegmentedControl key={key} style={style} value={p('value')} options={asOptions(p('options'))} block={!!p('block')} disabled={!!p('disabled')} onChange={v=>action(event('onChange'),v)}/>;
      case 'Chart':return <Chart key={key} content={p('content')}/>;
      default:return <UnsupportedComponent key={key} name={name}/>;
    }
  };
  if (targets) return <>{runtime.document.children.map((node, index) =>
    targets[index] ? createPortal(<ThemeProvider name="studio" mode={themeMode}><div className="iui-root">{render(node, index)}</div></ThemeProvider>, targets[index], index) : null)}</>;
  return <div className="iui-root">{runtime.document.children.map((n,i)=>render(n,i))}</div>;
}
