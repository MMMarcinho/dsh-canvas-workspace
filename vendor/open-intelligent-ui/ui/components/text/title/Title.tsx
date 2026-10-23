import React from 'react';
import type { ContentProps } from '../shared.js';

export function Title({children,style}:ContentProps){return <h3 className="iui-title" style={style}>{children}</h3>;}
