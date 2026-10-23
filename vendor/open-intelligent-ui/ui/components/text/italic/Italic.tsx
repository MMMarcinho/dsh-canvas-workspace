import React from 'react';
import type { ContentProps } from '../shared.js';

export function Italic({children,style}:ContentProps){return <em style={style}>{children}</em>;}
