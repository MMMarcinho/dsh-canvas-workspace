import React from 'react';
import type { LayoutProps } from '../shared.js';

export function List({children,style,marker}:{children?:React.ReactNode;style?:React.CSSProperties;marker?:string}){const listStyle={...style,listStyleType:marker==='none'?'none':marker==='disc'?'disc':undefined};return marker==='disc'?<ul className="iui-list" style={listStyle}>{children}</ul>:<ol className="iui-list" style={listStyle}>{children}</ol>;}
