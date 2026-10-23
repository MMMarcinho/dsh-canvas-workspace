import React from 'react';
import type { ContentProps } from '../shared.js';

export function Strikethrough({children,style}:ContentProps){return <s style={style}>{children}</s>;}
