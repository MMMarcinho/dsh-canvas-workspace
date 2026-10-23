import React from 'react';
import type { LayoutProps } from '../shared.js';

export function TableCell({children,style}:LayoutProps){return <div role="cell" className="iui-table-cell" style={style}>{children}</div>;}
