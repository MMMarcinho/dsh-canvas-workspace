import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Column({children,style}:LayoutProps){return <div className="iui-col" style={style}>{children}</div>;}
