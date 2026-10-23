import React, { useRef, useState } from 'react';
import type { AppBlockRequest, HostAdapter } from '../../../../protocol/types.js';
import { isolatedAppDocument } from './sandbox.js';

type Props={request:AppBlockRequest;adapter:HostAdapter};
type Session={sourceKey:string;document:string;sequence:number};

export function AppBlock({request,adapter}:Props){
  const sourceKey=`${request.messageId}\u0000${request.id}\u0000${request.html}`;
  const latest=useRef(sourceKey);latest.current=sourceKey;
  const attempt=useRef(0);
  const [session,setSession]=useState<Session|null>(null);
  const [status,setStatus]=useState('等待明确点击运行');
  const runLabel=request.id==='tetris-game-2026'?'运行俄罗斯方块':request.id==='paint-demo-01'?'运行交互式画板':'运行已审阅内容';
  const live=session?.sourceKey===sourceKey?session:null;
  const run=async()=>{
    const current=++attempt.current;
    if(!adapter.authorizeAppBlock){setStatus('宿主未配置：没有可运行的 AppBlock 审阅器');return;}
    setStatus('正在核对已审阅样本…');
    try{
      const result=await adapter.authorizeAppBlock(request);
      if(current!==attempt.current||latest.current!==sourceKey)return;
      if(!result.ok||!result.html){setSession(null);setStatus(result.message||'当前内容未经审阅，不能运行');return;}
      const document=isolatedAppDocument(result.html);
      setSession({sourceKey,document,sequence:(session?.sequence??0)+1});
      setStatus('隔离运行中 · 网络、父页面与账号不可访问');
    }catch(error){if(current===attempt.current){setSession(null);setStatus(`运行失败：${String(error)}`);}}
  };
  const stop=()=>{attempt.current++;setSession(null);setStatus('已停止；iframe 已销毁');};
  const restart=()=>{if(!live)return;attempt.current++;setSession({...live,sequence:live.sequence+1});setStatus('已重启隔离实例');};
  return <section className={`iui-app-block ${request.id==='paint-demo-01'?'is-paint':''}`} aria-label={`AppBlock ${request.title||request.id}`}>
    <div className="iui-app-block-head"><div><strong>{request.title||'AppBlock'}</strong><small>本地受限宿主演示 · 需手动运行</small></div><div className="iui-app-block-actions"><button type="button" onClick={()=>void run()} disabled={!request.html}>{live?'重新核对并运行':runLabel}</button><button type="button" onClick={stop} disabled={!live}>停止</button><button type="button" onClick={restart} disabled={!live}>重启</button></div></div>
    <p className="iui-app-block-status" role="status">{live?'● ':''}{live?status:session?'内容已变化，原实例已隔离停止':status}</p>
    {live?<iframe key={`${request.messageId}:${live.sequence}`} title={`${request.title||'AppBlock'} 隔离应用`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={live.document}/>:<div className="iui-app-block-empty">明确点击运行后才会创建独立沙箱。改动源码后需重新审阅。</div>}
  </section>;
}
