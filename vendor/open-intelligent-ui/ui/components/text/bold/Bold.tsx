import React from 'react';
import type { ContentProps } from '../shared.js';

export function Bold({children,style}:ContentProps){return <strong style={style}>{children}</strong>;}
