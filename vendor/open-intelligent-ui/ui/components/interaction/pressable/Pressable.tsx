import React, { useContext } from 'react';
import { RadioContext } from '../shared.js';
import type { ClickProps, FieldProps, SelectOption } from '../shared.js';

export function Pressable({children,style,onClick,disabled=false}:ClickProps){return <button type="button" className="iui-pressable" style={style} onClick={onClick} disabled={disabled}>{children}</button>;}
