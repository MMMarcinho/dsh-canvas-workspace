import React from 'react';
import type { ContentProps } from '../shared.js';

export function Caption({children,style}:ContentProps){return <small className="iui-caption" style={style}>{children}</small>;}
