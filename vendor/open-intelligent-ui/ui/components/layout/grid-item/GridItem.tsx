import React from 'react';
import type { LayoutProps } from '../shared.js';

export function GridItem({children,style}:LayoutProps){return <div className="iui-grid-item" style={style}>{children}</div>;}
