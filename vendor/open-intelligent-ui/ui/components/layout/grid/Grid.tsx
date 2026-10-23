import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Grid({children,style,columns=2}:{children?:React.ReactNode;style?:React.CSSProperties;columns?:number}){return <div className="iui-grid" style={{...style,gridTemplateColumns:`repeat(${Math.max(1,Math.min(6,columns))},minmax(0,1fr))`}}>{children}</div>;}
