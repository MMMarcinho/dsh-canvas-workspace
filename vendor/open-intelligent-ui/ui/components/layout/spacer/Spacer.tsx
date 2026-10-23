import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Spacer({style}:{style?:React.CSSProperties}){return <span className="iui-spacer" style={{flex:1,minWidth:8,...style}}/>;}
