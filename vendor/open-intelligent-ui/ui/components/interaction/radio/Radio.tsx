import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Radio({children,value,disabled=false,style}:{children?:React.ReactNode;value:unknown;disabled?:boolean;style?:React.CSSProperties}){const group=useContext(RadioContext);return <label className="iui-check" style={style}><input type="radio" checked={group.value===value} onChange={()=>group.onChange?.(value)} disabled={disabled}/><span>{children}</span></label>;}
