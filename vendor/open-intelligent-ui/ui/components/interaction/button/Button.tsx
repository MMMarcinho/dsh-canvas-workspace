import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Button({children,style,onClick,disabled=false,variant,block=false}:ClickProps){return <button type="button" className={`iui-button${variant==='ghost'||variant==='outline'?` iui-${variant}`:''}`} style={{...style,width:block?'100%':style?.width}} onClick={onClick} disabled={disabled}>{children}</button>;}
