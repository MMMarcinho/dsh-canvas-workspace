import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Flow({children,style}:LayoutProps){return <div className="iui-flow" style={style}>{children}</div>;}
