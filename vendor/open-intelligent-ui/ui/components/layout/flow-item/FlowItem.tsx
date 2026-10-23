import React from 'react';
import type { LayoutProps } from '../shared.js';

export function FlowItem({children,style}:LayoutProps){return <div className="iui-flow-item" style={style}>{children}</div>;}
