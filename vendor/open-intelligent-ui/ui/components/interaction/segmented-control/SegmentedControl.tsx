import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function SegmentedControl({value,onChange,options=[],disabled=false,style,block=false}:{value:unknown;onChange?:(value:unknown)=>void;options?:SelectOption[];disabled?:boolean;style?:React.CSSProperties;block?:boolean}){return <div className="iui-segments" style={{...style,width:block?'100%':style?.width}}>{options.map((o,i)=><button type="button" key={`${o.value}-${i}`} className={value===o.value?'active':''} onClick={()=>onChange?.(o.value)} disabled={disabled}>{o.label}</button>)}</div>;}
