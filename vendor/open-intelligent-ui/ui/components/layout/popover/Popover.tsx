import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Popover({children,style}:LayoutProps){return <details className="iui-popover" style={style}>{children}</details>;}
