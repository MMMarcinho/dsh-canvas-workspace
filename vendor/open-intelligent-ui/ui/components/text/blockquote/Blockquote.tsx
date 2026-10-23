import React from 'react';
import type { ContentProps } from '../shared.js';

export function Blockquote({children,style}:ContentProps){return <blockquote style={style}>{children}</blockquote>;}
