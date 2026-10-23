import React from 'react';
import type { ContentProps } from '../shared.js';

const glyphs:Record<string,string>={check:'✓','check-circle':'✓','alert-triangle':'⚠',settings:'⚙',github:'◆',sparkles:'✦',copy:'⧉',info:'ⓘ',cpu:'▣',layers:'▤','arrow-right':'→','chevron-right':'›','arrow-down':'↓','arrow-down-up':'↕','chart-no-axes-combined':'▥','shield-check':'⬡'};
export function Icon({name,style,inline=false}:{name:string;style?:React.CSSProperties;inline?:boolean}){return <span className="iui-icon" style={{...style,display:inline?'inline-flex':undefined}} aria-label={name}>{glyphs[name]??'•'}</span>;}
