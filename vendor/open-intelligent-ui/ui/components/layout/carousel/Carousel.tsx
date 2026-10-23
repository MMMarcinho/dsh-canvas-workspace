import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Carousel({children,activeIndex=0,onChange,style}:{children?:React.ReactNode;activeIndex?:number;onChange?:(value:number)=>void;style?:React.CSSProperties}){const items=React.Children.toArray(children),index=Math.max(0,Math.min(items.length-1,Math.trunc(activeIndex)));return <div className="iui-carousel" style={style}><button type="button" aria-label="上一项" disabled={index<=0} onClick={()=>onChange?.(index-1)}>‹</button><div>{items[index]}</div><button type="button" aria-label="下一项" disabled={index>=items.length-1} onClick={()=>onChange?.(index+1)}>›</button></div>;}
