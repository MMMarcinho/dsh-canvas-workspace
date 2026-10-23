import React, { createContext, useContext } from 'react';
export type ThemeName='studio'|'citrus';export type ThemeMode='light'|'dark';
export type ThemeTokens={background:string;surface:string;surfaceMuted:string;surfaceTertiary:string;text:string;textMuted:string;border:string;primary:string;success:string;warning:string;danger:string;info:string;fontFamily:string;radius:number;spacing:number;shadow:'none'|'soft'|'lift';chart:[string,string,string,string]};
const systemFont='ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif';
const serifFont='Iowan Old Style,Georgia,serif';
export const themes:Record<ThemeName,Record<ThemeMode,ThemeTokens>>={
  studio:{
    light:{background:'#fcfcfc',surface:'#ffffff',surfaceMuted:'#f7f7f7',surfaceTertiary:'#eeeeee',text:'#0d0d0d',textMuted:'#5d5d5d',border:'#e5e5e5',primary:'#181818',success:'#008635',warning:'#a36a0a',danger:'#b42332',info:'#315dcc',fontFamily:systemFont,radius:16,spacing:4,shadow:'soft',chart:['#6c83df','#18a281','#e9a53e','#a87ad8']},
    dark:{background:'#181818',surface:'#222222',surfaceMuted:'#2b2b2b',surfaceTertiary:'#353535',text:'#f5f5f5',textMuted:'#b4b4b4',border:'#404040',primary:'#f5f5f5',success:'#6cdb93',warning:'#f0bd67',danger:'#ff8995',info:'#9eb8ff',fontFamily:systemFont,radius:16,spacing:4,shadow:'soft',chart:['#93a8ff','#61d1af','#f1c073','#c8a4ee']}
  },
  citrus:{
    light:{background:'#f4f0df',surface:'#fffcef',surfaceMuted:'#f5ecd0',surfaceTertiary:'#e7debc',text:'#243b2d',textMuted:'#69765c',border:'#b9c69b',primary:'#256d4b',success:'#287e54',warning:'#aa6427',danger:'#aa4c3c',info:'#4267a3',fontFamily:serifFont,radius:4,spacing:8,shadow:'lift',chart:['#256d4b','#d78e36','#677db1','#b66274']},
    dark:{background:'#17231b',surface:'#213529',surfaceMuted:'#2d4131',surfaceTertiary:'#3a5139',text:'#f7f0d9',textMuted:'#bfccb3',border:'#658367',primary:'#a8d78a',success:'#91d4a2',warning:'#edbd6e',danger:'#e89378',info:'#9bb6e5',fontFamily:serifFont,radius:4,spacing:8,shadow:'lift',chart:['#a8d78a','#edbd6e','#9bb6e5','#e6a4ab']}
  }
};
const color=/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
export function mergeTheme(name:ThemeName,mode:ThemeMode,overrides:Partial<ThemeTokens>={}):ThemeTokens{
  const base=themes[name][mode],out={...base,chart:[...base.chart] as ThemeTokens['chart']};
  for(const [key,value] of Object.entries(overrides)){
    if(key==='chart'){if(Array.isArray(value)&&value.length===4&&value.every(v=>typeof v==='string'&&color.test(v)))out.chart=value as ThemeTokens['chart'];continue;}
    if(key==='radius'||key==='spacing'){if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=32)(out as any)[key]=value;continue;}
    if(key==='fontFamily'){if(value===systemFont||value===serifFont)(out as any)[key]=value;continue;}
    if(key==='shadow'){if(value==='none'||value==='soft'||value==='lift')out.shadow=value;continue;}
    if(Object.prototype.hasOwnProperty.call(base,key)&&typeof value==='string'&&color.test(value))(out as any)[key]=value;
  }
  return out;
}
const ThemeContext=createContext<ThemeTokens>(themes.studio.light);
export const useTheme=()=>useContext(ThemeContext);
export function ThemeProvider({name='studio',mode='light',overrides={},children}:{name?:ThemeName;mode?:ThemeMode;overrides?:Partial<ThemeTokens>;children:React.ReactNode}){
  const t=mergeTheme(name,mode,overrides);
  const vars:Record<string,string>={
    '--iui-background':t.background,'--iui-surface':t.surface,'--iui-surface-muted':t.surfaceMuted,'--iui-surface-tertiary':t.surfaceTertiary,'--iui-text':t.text,'--iui-text-muted':t.textMuted,'--iui-border':t.border,'--iui-primary':t.primary,'--iui-success':t.success,'--iui-warning':t.warning,'--iui-danger':t.danger,'--iui-info':t.info,'--iui-font':t.fontFamily,'--iui-radius':`${t.radius}px`,'--iui-spacing':`${t.spacing}px`,'--iui-shadow':t.shadow==='none'?'none':t.shadow==='lift'?'0 13px 0 #0000001a':'0 3px 12px #0000000d',
    ...Object.fromEntries(t.chart.map((c,i)=>[`--iui-chart-${i+1}`,c]))
  };
  return <ThemeContext.Provider value={t}><div className="iui-theme" style={{...vars,colorScheme:mode} as React.CSSProperties}>{children}</div></ThemeContext.Provider>;
}
