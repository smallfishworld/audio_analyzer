import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type SpectrogramData = {
  startSec:number;endSec:number;nyquistHz:number;columns:number[][];
};

type Hover = { timeSec:number; frequencyHz:number; dbfs:number } | null;

// Fixed, calibrated dBFS palette. Black = silence; yellow = strong signal.
// The previous blue-for-silence palette made clean tones look like solid images.
const STOPS: [number,number,number,number][] = [
  [-120,7,13,23],[-90,12,24,37],[-70,24,54,78],
  [-52,31,100,127],[-35,23,185,166],[-16,250,157,72],[0,255,241,194],[6,255,255,239],
];
export function dbColor(db:number):[number,number,number]{
  const v=Number.isFinite(db)?Math.max(-120,Math.min(6,db)):-120;
  for(let i=1;i<STOPS.length;i++){
    if(v>STOPS[i][0])continue;
    const [lo,r1,g1,b1]=STOPS[i-1];
    const [hi,r2,g2,b2]=STOPS[i];
    const t=(v-lo)/(hi-lo);
    return [Math.round(r1+(r2-r1)*t),Math.round(g1+(g2-g1)*t),Math.round(b1+(b2-b1)*t)];
  }
  return [255,255,239];
}
export default function SpectrogramView({data,onSeek}:{
  data:SpectrogramData|null;onSeek:(time:number)=>void;
}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [hover,setHover]=useState<Hover>(null);
  useEffect(()=>{
    const el=canvas.current;
    if(!el||!data?.columns.length)return;
    const w=data.columns.length,h=data.columns[0].length;
    if(!w||!h)return;
    el.width=w;el.height=h;
    const ctx=el.getContext("2d");if(!ctx)return;
    const bitmap=ctx.createImageData(w,h);
    for(let x=0;x<w;x++)for(let y=0;y<h;y++){
      const row=h-1-y;
      const levels=data.columns[x];
      // A single narrow 4 kHz FFT bin would be subpixel-high on the
      // resized canvas; widen with a *display only* 1-row visual halo.
      const value=Math.max(levels?.[row]??-120,
        (levels?.[row-1]??-120)-17,(levels?.[row+1]??-120)-17);
      const [r,g,b]=dbColor(value);
      const index=4*(y*w+x);
      bitmap.data[index]=r;bitmap.data[index+1]=g;
      bitmap.data[index+2]=b;bitmap.data[index+3]=255;
    }
    ctx.putImageData(bitmap,0,0);
  },[data]);
  function at(e:React.MouseEvent<HTMLCanvasElement>) {
    if(!data?.columns.length)return;
    const bounds=e.currentTarget.getBoundingClientRect();
    const rx=Math.max(0,Math.min(1,(e.clientX-bounds.left)/bounds.width));
    const ry=Math.max(0,Math.min(1,(e.clientY-bounds.top)/bounds.height));
    const column=Math.min(data.columns.length-1,Math.floor(rx*data.columns.length));
    const bins=data.columns[column];
    if(!bins?.length)return;
    const row=Math.min(bins.length-1,Math.round((1-ry)*(bins.length-1)));
    return {timeSec:data.startSec+rx*(data.endSec-data.startSec),
      frequencyHz:(1-ry)*data.nyquistHz,dbfs:bins[row]};
  }
  const style:CSSProperties={width:"100%",height:208,objectFit:"fill",imageRendering:"auto"};
  return <section className="ws-spectrogram">
    <header className="panel-title"><span>Time–frequency · STFT</span>
      <span className="panel-subtle">{data ? "0 – "+(data.nyquistHz/1000).toFixed(2)+" kHz" : "Select audio"}</span>
    </header>
    {data?.columns.length ? <>
      <div className="spectrogram-layout">
        <div className="spectrogram-axis">
          <span>{(data.nyquistHz/1000).toFixed(1)}k</span>
          <span>{(data.nyquistHz*0.75/1000).toFixed(1)}k</span>
          <span>{(data.nyquistHz*0.5/1000).toFixed(1)}k</span>
          <span>{(data.nyquistHz*0.25/1000).toFixed(1)}k</span><span>0</span>
        </div>
        <canvas ref={canvas} style={style} role="img" aria-label="STFT time frequency spectrogram"
          onMouseMove={e=>setHover(at(e)??null)} onMouseLeave={()=>setHover(null)}
          onClick={e=>{const where=at(e);if(where)onSeek(where.timeSec);}}/>
      </div>
      <div className="spectrogram-footer">
        <span>{data.startSec.toFixed(3)}s</span>
        <span>{hover
          ? hover.timeSec.toFixed(3)+"s · "+(hover.frequencyHz/1000).toFixed(2)+"kHz · "+hover.dbfs.toFixed(1)+"dBFS"
          : "Click to seek · time / frequency in dBFS"}</span>
        <span>{data.endSec.toFixed(3)}s</span>
      </div>
      <div className="spectrogram-scale"><span>−120</span><div className="spectrogram-scale-ramp"/><span>0 dBFS</span></div>
    </>:<p className="panel-help">Analyze a time range to display its spectrogram.</p>}
  </section>;
}
