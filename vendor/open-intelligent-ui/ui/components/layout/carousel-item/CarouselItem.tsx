import React from 'react';
import type { LayoutProps } from '../shared.js';

export function CarouselItem({children,style}:LayoutProps){return <div className="iui-carousel-item" style={style}>{children}</div>;}
