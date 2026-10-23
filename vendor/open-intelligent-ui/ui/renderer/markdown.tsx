import React from 'react';
import { safeUrl } from '../../protocol/index.js';
/** Deliberately small Markdown subset. React escapes all text; raw HTML is never inserted. */
export function renderMarkdownText(text:string):React.ReactNode[]{
  const result:React.ReactNode[]=[],pattern=/(```[\s\S]*?```|~~~[\s\S]*?~~~|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;let last=0,m:RegExpExecArray|null,index=0;
  while((m=pattern.exec(text))){if(m.index>last)result.push(text.slice(last,m.index));const token=m[0],key=index++;
    if(token.startsWith('```')||token.startsWith('~~~'))result.push(<pre key={key} className="iui-code"><code>{token.slice(3,-3).replace(/^[^\n]*\n/,'')}</code></pre>);
    else if(token.startsWith('**'))result.push(<strong key={key}>{token.slice(2,-2)}</strong>);
    else if(token.startsWith('~~'))result.push(<s key={key}>{token.slice(2,-2)}</s>);
    else if(token.startsWith('`'))result.push(<code key={key}>{token.slice(1,-1)}</code>);
    else if(token.startsWith('*'))result.push(<em key={key}>{token.slice(1,-1)}</em>);
    else {const x=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);const url=x&&safeUrl(x[2]);result.push(url?<a key={key} href={url} target="_blank" rel="noopener noreferrer">{x![1]}</a>:x?.[1]||token);}
    last=pattern.lastIndex;
  }
  if(last<text.length)result.push(text.slice(last));return result;
}
