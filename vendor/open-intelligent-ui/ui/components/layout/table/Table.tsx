import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Table({children,style}:LayoutProps){return <div role="table" className="iui-table" style={style}>{children}</div>;}
