import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Input({value,onChange,placeholder='',style,disabled=false,number=false,block=false}:FieldProps&{number?:boolean}){return <input className="iui-field" type={number?'number':'text'} value={value} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} style={{...style,width:block?'100%':style?.width}} disabled={disabled}/>;}
