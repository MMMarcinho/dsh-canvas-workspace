import React, { createContext } from 'react';
export type ClickProps={children?:React.ReactNode;style?:React.CSSProperties;onClick?:()=>void;disabled?:boolean;variant?:string;block?:boolean};
export type FieldProps={value:string;onChange?:(value:string)=>void;placeholder?:string;style?:React.CSSProperties;disabled?:boolean;block?:boolean};
export type SelectOption={label:string;value:string};
export const RadioContext=createContext<{value:unknown;onChange?:(value:unknown)=>void}>({value:undefined});
