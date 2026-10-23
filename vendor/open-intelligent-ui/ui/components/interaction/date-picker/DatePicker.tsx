import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function DatePicker({value,onChange,disabled=false,style,block=false}:FieldProps){return <input className="iui-field" type="date" value={value} onChange={e=>onChange?.(e.target.value)} disabled={disabled} style={{...style,width:block?'100%':style?.width}}/>;}
