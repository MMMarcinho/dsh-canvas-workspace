import React from 'react';
import type { ContentProps } from '../shared.js';

export function Text({children,style}:ContentProps){return <span className="iui-text" style={style}>{children}</span>;}
