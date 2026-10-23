import React from 'react';
import type { LayoutProps } from '../shared.js';

export function TableRow({children,style}:LayoutProps){return <div role="row" className="iui-table-row" style={style}>{children}</div>;}
