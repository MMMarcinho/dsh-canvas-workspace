import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Row({children,style}:LayoutProps){return <div className="iui-row" style={style}>{children}</div>;}
