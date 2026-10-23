import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Select({value,onChange,options=[],style,disabled=false,block=false}:FieldProps&{options?:SelectOption[]}){return <select className="iui-field" value={value} onChange={e=>onChange?.(e.target.value)} style={{...style,width:block?'100%':style?.width}} disabled={disabled}>{options.map((o,i)=><option key={`${o.value}-${i}`} value={o.value}>{o.label}</option>)}</select>;}
