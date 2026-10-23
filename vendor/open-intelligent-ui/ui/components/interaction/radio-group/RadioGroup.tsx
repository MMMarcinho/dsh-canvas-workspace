import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function RadioGroup({children,value,onChange,direction='row',style}:{children?:React.ReactNode;value:unknown;onChange?:(value:unknown)=>void;direction?:string;style?:React.CSSProperties}){return <RadioContext.Provider value={{value,onChange}}><div className={`iui-radio-group${direction==='col'?' vertical':''}`} style={style}>{children}</div></RadioContext.Provider>;}
