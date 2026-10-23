import React from 'react';
import type { ContentProps } from '../shared.js';

/** Plain text only: formula layout is not established by the captured samples. */
export function MathText({children,style}:ContentProps){return <span className="iui-math" style={style}>{children}</span>;}
