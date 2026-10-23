import React from 'react';
import type { LayoutProps } from '../shared.js';

export function PopoverContent({children,style}:LayoutProps){return <div className="iui-popover-content" style={style}>{children}</div>;}
