import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Box({children,style}:LayoutProps){return <div className="iui-box" style={style}>{children}</div>;}
