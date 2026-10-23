import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Checkbox({children,checked,onChange,disabled=false,lineThrough=false,style}:{children?:React.ReactNode;checked:boolean;onChange?:(value:boolean)=>void;disabled?:boolean;lineThrough?:boolean;style?:React.CSSProperties}){return <label className="iui-check" style={style}><input type="checkbox" checked={checked} onChange={e=>onChange?.(e.target.checked)} disabled={disabled}/><span style={{textDecoration:checked&&lineThrough?'line-through':undefined}}>{children}</span></label>;}
