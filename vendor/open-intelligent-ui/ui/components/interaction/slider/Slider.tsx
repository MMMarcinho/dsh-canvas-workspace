import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Slider({value,onChange,min=0,max=100,step=1,disabled=false,style}:{value:number;onChange?:(value:number)=>void;min?:number;max?:number;step?:number;disabled?:boolean;style?:React.CSSProperties}){return <input className="iui-slider" type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange?.(Number(e.target.value))} disabled={disabled} style={style}/>;}
