import React from 'react';
import type { LayoutProps } from '../shared.js';

export function Card({children,style}:LayoutProps){return <section className="iui-card" style={style}>{children}</section>;}
