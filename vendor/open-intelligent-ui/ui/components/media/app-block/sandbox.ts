export const appBlockCsp="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'";

/** Minimal local utility styles for the reviewed sample; no Tailwind/CDN or GPT host styles. */
const sampleStyles=`
:root{--viz-border:#344357;--viz-card:#1e2a3b;--viz-panel:#243247;--viz-accent-bg:#394b75;--viz-accent:#8b8cf5;--viz-text:#eef3fa;--viz-muted:#a8b7ca}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#111b2a;color:#eef3fa;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
button{font:inherit;color:inherit;cursor:pointer}#tetris-root{display:flex;flex-direction:column;align-items:center;gap:12px;padding:10px;width:100%;font-size:14px}
.flex{display:flex}.flex-col{flex-direction:column}.items-center{align-items:center}.justify-between{justify-content:space-between}.justify-center{justify-content:center}.items-start{align-items:flex-start}.flex-1{flex:1}.min-w-0{min-width:0}.w-full{width:100%}
.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.grid{display:grid}.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.col-span-4{grid-column:span 4}
.gap-2{gap:8px}.gap-3{gap:12px}.p-2{padding:8px}.px-5{padding-left:20px;padding-right:20px}.py-2{padding-top:8px;padding-bottom:8px}.rounded-lg{border-radius:8px}
.font-bold{font-weight:700}.font-semibold{font-weight:600}.text-xs{font-size:12px}.text-sm{font-size:14px}.text-base{font-size:16px}.text-lg{font-size:18px}.text-xl{font-size:22px}.text-center{text-align:center}.tabular-nums{font-variant-numeric:tabular-nums}.mb-1{margin-bottom:4px}
.max-w-\\[390px\\]{max-width:390px}#tetris-root .game-area{max-width:390px}#tetris-root .game-area>div:last-child{min-width:92px}#tetris-root [data-move]{user-select:none;-webkit-user-select:none}
@media(max-width:375px){#tetris-root .game-area{gap:8px}#tetris-root .game-area>div:last-child{min-width:78px}#tetris-root .stat{padding:5px}}
`;

export function validApprovedAppHtml(html:string):boolean {
  return new TextEncoder().encode(html).length<=32_000
    && !/<\s*(?:iframe|object|embed|link|base|form)\b/i.test(html)
    && !/<script\b[^>]*\bsrc\s*=/i.test(html)
    && !/\b(?:src|href)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:)/i.test(html);
}

export function isolatedAppDocument(approvedHtml:string):string {
  if(!validApprovedAppHtml(approvedHtml))throw new Error('AppBlock 宿主内容未通过静态限制');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${appBlockCsp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${sampleStyles}</style></head><body>${approvedHtml}</body></html>`;
}
