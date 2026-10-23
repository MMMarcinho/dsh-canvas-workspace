import React from 'react';
import type { ContentProps } from '../shared.js';

export function Label({children,style}:ContentProps){return <div className="iui-label" style={style}>{children}</div>;}
