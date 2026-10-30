import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

export type SpectrogramData = {
  startSec: number; endSec: number; nyquistHz: number; columns: number[][];
};

export default function SpectrogramView({ data, onSeek }: {
  data: SpectrogramData | null; onSeek: (t: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el=canvas.current;
    if (!el || !data || !data.columns.length) return;
    const w=data.columns.length, h=data.columns[0].length;
    el.width=w;el.height=h;
    const ctx=el.getContext("2d");
    if (!ctx) return;
    const pixels=ctx.createImageData(w,h);
    for(let x=0;x<w;x++) for(let y=0;y<h;y++){
      // Spectrogram has low frequency at bottom, high frequency at top.
      const level=data.columns[x]?.[h-1-y] ?? -120;
      const t=Math.max(0,Math.min(1,(level+110)/110));
      const at=(y*w+x)*4;
      pixels.data[at]=Math.round(9+246*t*t);
      pixels.data[at+1]=Math.round(21+210*Math.sin(Math.PI*t*0.9));
      pixels.data[at+2]=Math.round(39+170*(1-t));
      pixels.data[at+3]=255;
    }
    ctx.putImageData(pixels,0,0);
  },[data]);
  const style:CSSProperties={width:"100%",height:200,objectFit:"fill",imageRendering:"auto"};
  return <section className="ws-spectrogram">
    <header className="panel-title"><span>Time–frequency · STFT</span>
      <span className="panel-subtle">{data ? "0 – "+(data.nyquistHz/1000).toFixed(1)+" kHz" : "Select a file"}</span>
    </header>
    {data?.columns.length ? <>
      <div className="spectrogram-layout">
        <div className="spectrogram-axis"><span>{(data.nyquistHz/1000).toFixed(1)}k</span><span>{(data.nyquistHz/2000).toFixed(1)}k</span><span>0</span></div>
        <canvas ref={canvas} style={style} role="img" aria-label="STFT time frequency spectrogram"
          onClick={e=>{
            const bounds=e.currentTarget.getBoundingClientRect();
            const time=data.startSec+(e.clientX-bounds.left)/bounds.width*(data.endSec-data.startSec);
            onSeek(time);
          }}/>
      </div>
      <div className="spectrogram-footer"><span>{data.startSec.toFixed(3)}s</span><span>Click to move waveform cursor · dBFS heatmap (−110 to 0)</span><span>{data.endSec.toFixed(3)}s</span></div>
    </> : <p className="panel-help">Analyze a time range to display its spectrogram.</p>}
  </section>;
}
