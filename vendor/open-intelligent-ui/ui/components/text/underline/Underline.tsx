import React from 'react';
import type { ContentProps } from '../shared.js';

export function Underline({children,style}:ContentProps){return <u style={style}>{children}</u>;}
