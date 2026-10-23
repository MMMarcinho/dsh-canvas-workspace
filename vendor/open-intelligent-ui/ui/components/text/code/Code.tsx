import React from 'react';
import type { ContentProps } from '../shared.js';

export function Code({children,style}:ContentProps){return <pre className="iui-code" style={style}><code>{children}</code></pre>;}
