import React from 'react';
import type { ContentProps } from '../shared.js';

export function Badge({children,style}:ContentProps){return <span className="iui-badge" style={style}>{children}</span>;}
