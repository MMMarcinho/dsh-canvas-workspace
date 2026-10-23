import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Textarea({value,onChange,placeholder='',style,disabled=false,rows=3,block=false}:FieldProps&{rows?:number}){return <textarea className="iui-field" value={value} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} rows={Math.max(1,Math.min(12,rows))} style={{...style,width:block?'100%':style?.width}} disabled={disabled}/>;}
