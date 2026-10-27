import React from "react";
import { createRoot } from "react-dom/client";
import { ReplyContent } from "../src/ui/ReplyContent";
import "../vendor/deepseek-harness/base.css";
import "../vendor/deepseek-harness/design-platform.css";
import "../src/styles.css";

const fleet = `{@body const macs=[{id:0},{id:1},{id:2}]}
{@body const [sel,setSel]=DIL.useState([false,false,false])}
{@body const [st,setSt]=DIL.useState([0,0,0])}
{@body const onCount=sel.filter(Boolean).length}
{@body const doneCount=st.filter(s=>s===4).length}
<box><title>机队控制台</title>
{#each macs as m}<row><checkbox checked={sel[m.id]} onChange={()=>setSel(v=>v.map((b,i)=>i===m.id?!b:b))}>机组 {m.id}</checkbox><text>{st[m.id]===-1?'失败':st[m.id]===4?'已上线':'未完成'}</text></row>{/each}
<button onClick={()=>setSt(v=>v.map((s,i)=>sel[i]&&s===0?1:s))}>启动</button>
<button onClick={()=>setSt(v=>v.map((s,i)=>sel[i]&&s>0&&s<4?s+1:s))}>下一步</button>
<button onClick={()=>setSt(v=>v.map((s,i)=>i===2&&s>0&&s<4?-1:s))}>失败</button>
<button onClick={()=>setSt([0,0,0])}>重置</button>
</box>

中间说明。

<card><badge>已上线 {doneCount} / 3</badge><badge>选中 {onCount} 台</badge></card>`;

createRoot(document.getElementById("root")!).render(
  <ReplyContent
    text={fleet}
    messageId="fleet-browser"
    streaming={false}
    iuiEnabled
  />,
);
