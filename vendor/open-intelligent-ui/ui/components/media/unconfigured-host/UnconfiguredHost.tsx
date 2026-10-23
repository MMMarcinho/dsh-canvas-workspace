import React from 'react';

export function UnconfiguredHost({name}:{name:string}){return <div className="iui-unavailable" data-component={name}><strong>{name}</strong> · 宿主未配置。需由宿主提供可信资源或授权操作。</div>;}
