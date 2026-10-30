import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, ZoomIn, ZoomOut, Crosshair, Activity } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

type EnvelopePoint = { timeSec: number; min: number; max: number };
type RawSpec = { sampleRateHz:number; channels:number; sampleFormat:string; endianness:string; byteOffset:number; layout:"interleaved"|"planar" };
type AudioChunk = { startSec:number; sampleRateHz:number; samples:number[] };
type WaveData = {
  waveform: EnvelopePoint[];
  sampleRateHz: number;
  analyzedFrames: number;
  metadata: { durationSeconds: number | null } | null;
  selectedChannel: number;
  previewLimited: boolean;
};
type View = { start: number; end: number };
type Range = { start: number; end: number };
const LEFT = 56;
const RIGHT = 20;
const TOP = 22;
const BOTTOM = 29;
const HEIGHT = 320;
function clamp(x: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, x)); }
function fullDuration(data: WaveData | null): number {
  if (!data || !Number.isFinite(data.sampleRateHz) || data.sampleRateHz <= 0) return 1;
  const duration = data.previewLimited ? data.analyzedFrames / data.sampleRateHz :
    (data.metadata?.durationSeconds ?? data.analyzedFrames / data.sampleRateHz);
  return Number.isFinite(duration) && duration > 0 ? duration : 1;
}
function timeText(t: number) {
  if (!Number.isFinite(t)) return "--:--";
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3).padStart(6, "0");
  return (h > 0 ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + s;
}
export type WaveformControls = {
  zoomIn: () => void; zoomOut: () => void; fit: () => void;
  zoomSelection: () => void; goToStart: () => void; goToEnd: () => void;
  setCursor: (time: number) => void; zoomSamples: () => void;
};
export type WaveformRange = { start: number; end: number } | null;
type Props = { data: WaveData | null; sourcePath?:string|null; rawSpec?:RawSpec|null; playheadSec?:number|null; onCursorChange?: (time: number) => void; onSelectionChange?: (range: WaveformRange) => void };
const WaveformView = forwardRef<WaveformControls, Props>(function WaveformView({ data, sourcePath, rawSpec, playheadSec, onCursorChange, onSelectionChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overview = useRef<HTMLCanvasElement>(null);
  const navDrag = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const duration = fullDuration(data);
  const [view, setView] = useState<View>({ start: 0, end: duration });
  const [selection, setSelection] = useState<Range | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const [chunk, setChunk] = useState<AudioChunk | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const points = data?.waveform ?? [];
  const maxSampleSpan = data ? Math.min(2, 65536 / data.sampleRateHz) : 0;
  const sampleRequested = !!data && !!sourcePath && view.end - view.start <= maxSampleSpan;
  useEffect(() => {
    // A steady full-scale tone looks like a solid block at full-file resolution.
    // Open a short true-sample viewport while retaining the entire clip above.
    const dense = !!sourcePath && !!data && duration > 2 && points.length >= 128 &&
      points.filter(p => p.min < -0.8 && p.max > 0.8).length / points.length > 0.90;
    const focusSpan = dense && data
      ? Math.min(duration, Math.max(256 / data.sampleRateHz, 0.016))
      : duration;
    setView({ start: 0, end: focusSpan });
    setSelection(null);
    setCursor(null);
    onCursorChange?.(0);
    onSelectionChange?.(null);
  }, [data, duration, sourcePath]);
  useEffect(() => {
    let valid=true;
    setChunk(null);
    if (!sampleRequested || !data || !sourcePath) {
      setChunkLoading(false);
      return () => {valid=false;};
    }
    setChunkLoading(true);
    // Avoid dozens of file reads while the user is spinning the zoom wheel.
    const timer=window.setTimeout(()=>{
      const span=Math.min(view.end-view.start, duration-view.start);
      if(span<=0){setChunkLoading(false);return;}
      void invoke<AudioChunk>("audio_chunk",{
        path:sourcePath,rawSpec:rawSpec??null,channelIndex:data.selectedChannel,
        startSec:view.start,durationSec:span
      }).then(result=>{
        if(valid && result.sampleRateHz===data.sampleRateHz) setChunk(result);
      }).catch(()=>{
        // Preserve the existing overview, but never stretch its coarse buckets
        // into a fake sample trace if local loading fails.
      }).finally(()=>{if(valid)setChunkLoading(false);});
    },85);
    return ()=>{valid=false;window.clearTimeout(timer);};
  },[sampleRequested,sourcePath,rawSpec,data?.selectedChannel,data?.sampleRateHz,view.start,view.end,duration]);
  useEffect(() => {
    if (!wrap.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(Math.max(320, Math.floor(entries[0].contentRect.width)));
    });
    obs.observe(wrap.current);
    return () => obs.disconnect();
  }, []);
  const moveViewportTo = useCallback((time: number) => {
    const span = view.end - view.start;
    const start = clamp(time - span / 2, 0, Math.max(0, duration - span));
    setView({ start, end: start + span });
  }, [view, duration]);
  useEffect(() => {
    const el = overview.current;
    if (!el) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    el.width = Math.round(width * ratio);
    el.height = Math.round(52 * ratio);
    const ctx = el.getContext("2d"); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle="#091522"; ctx.fillRect(0,0,width,52);
    ctx.strokeStyle="#446477"; ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,26);ctx.lineTo(width,26);ctx.stroke();
    if (!points.length) return;
    ctx.strokeStyle="rgba(67,191,193,.48)";
    ctx.lineWidth=1;
    const w = Math.max(1,width);
    for (let i=0;i<points.length;i++) {
      const pt=points[i];
      if (!Number.isFinite(pt.min)||!Number.isFinite(pt.max)||!Number.isFinite(pt.timeSec)) continue;
      const x=Math.floor(pt.timeSec/duration*w);
      // Full overview only: do not stretch min/max buckets across the sample plot.
      const top=26-clamp(pt.max,-1,1)*22;
      const bottom=26-clamp(pt.min,-1,1)*22;
      ctx.beginPath();
      ctx.moveTo(Math.min(w,x)+0.5,top);
      ctx.lineTo(Math.min(w,x)+0.5,bottom);
      ctx.stroke();
    }
  },[points,duration,width]);
  const xForTime = useCallback((t: number) =>
    LEFT + ((t - view.start) / (view.end - view.start)) * (width - LEFT - RIGHT),
    [view, width]);
  const timeFromX = useCallback((x: number) =>
    clamp(view.start + ((x - LEFT) / Math.max(1, width - LEFT - RIGHT)) *
      (view.end - view.start), view.start, view.end),
    [view, width]);

  const zoom = useCallback((factor: number, focus: number) => {
    if (!data || points.length === 0) return;
    const current = view.end - view.start;
    const minSpan = Math.min(duration, 8 / data.sampleRateHz);
    const span = clamp(current * factor, minSpan, duration);
    const proportion = clamp((focus - view.start) / Math.max(current, 1e-12), 0, 1);
    const start = clamp(focus - span * proportion, 0, Math.max(0, duration - span));
    setView({ start, end: start + span });
  }, [data, duration, points.length, view]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    el.width = Math.round(width * pixelRatio);
    el.height = Math.round(HEIGHT * pixelRatio);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.fillStyle = "#091522";
    ctx.fillRect(0, 0, width, HEIGHT);
    const plotW = Math.max(1, width - LEFT - RIGHT);
    const plotH = HEIGHT - TOP - BOTTOM;
    const centerY = TOP + plotH / 2;
    const scaleY = plotH / 2 - 10;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const val of [-1, -0.5, 0, 0.5, 1]) {
      const y = centerY - val * scaleY;
      ctx.beginPath(); ctx.moveTo(LEFT, y); ctx.lineTo(width - RIGHT, y);
      ctx.strokeStyle = val === 0 ? "#48637c" : "#1f3448";
      ctx.lineWidth = val === 0 ? 1.3 : 1;
      ctx.stroke();
      ctx.fillStyle = "#8daac1";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), LEFT - 9, y);
    }
    ctx.textBaseline = "alphabetic";
    const tickCount = Math.max(2, Math.floor(plotW / 115));
    for (let i = 0; i <= tickCount; i++) {
      const x = LEFT + i / tickCount * plotW;
      ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, HEIGHT - BOTTOM);
      ctx.strokeStyle = "#203348"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#91a9bd"; ctx.textAlign = "center";
      ctx.fillText(timeText(view.start + i / tickCount * (view.end - view.start)), x, HEIGHT - 9);
    }
    if (points.length === 0) {
      ctx.fillStyle = "#96b0c3"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(data ? "No waveform samples available" : "Open an audio file to display its waveform",
        LEFT + plotW / 2, centerY);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(LEFT, TOP, plotW, plotH);
    ctx.clip();
    const samples=chunk?.samples ?? [];
    const usableSamples=sampleRequested && chunk && samples.length>1;
    if (usableSamples && chunk) {
      const sampleRate=chunk.sampleRateHz;
      // Rust seeks to an integer frame. The requested time is not always on
      // an exact sample boundary, so align the plotted samples explicitly.
      const sampleStart=Math.floor(chunk.startSec*sampleRate)/sampleRate;
      const first=Math.max(0,Math.floor((view.start-sampleStart)*sampleRate));
      const last=Math.min(samples.length,Math.ceil((view.end-sampleStart)*sampleRate));
      if(last-first <= plotW*3) {
        // True time-domain polyline; at 4 kHz/32 kHz this displays eight
        // individual samples per period instead of the 60-second min/max block.
        ctx.beginPath();
        for(let i=first;i<last;i++) {
          const x=xForTime(sampleStart+i/sampleRate);
          const y=centerY-clamp(samples[i],-1.1,1.1)*scaleY;
          if(i===first)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.strokeStyle="#61ede3";ctx.lineWidth=1.45;ctx.stroke();
        if(last-first<1300 && (plotW/(last-first))>4) {
          ctx.fillStyle="#e5fffb";
          for(let i=first;i<last;i++) {
            const x=xForTime(sampleStart+i/sampleRate);
            const y=centerY-clamp(samples[i],-1.1,1.1)*scaleY;
            ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();
          }
        }
      } else {
        // Moderate zoom: min/max aggregated into one column, never a
        // repeatedly stretched 50 ms overview bucket.
        const buckets=Math.max(1,Math.floor(plotW));
        const mins=new Float32Array(buckets).fill(Number.POSITIVE_INFINITY);
        const maxs=new Float32Array(buckets).fill(Number.NEGATIVE_INFINITY);
        for(let i=first;i<last;i++){
          const x=Math.floor((sampleStart+i/sampleRate-view.start)/(view.end-view.start)*plotW);
          if(x<0||x>=buckets)continue;
          mins[x]=Math.min(mins[x],samples[i]);
          maxs[x]=Math.max(maxs[x],samples[i]);
        }
        ctx.strokeStyle="rgba(82,224,218,.62)";ctx.lineWidth=1;
        ctx.beginPath();
        for(let i=0;i<buckets;i++){
          if(!Number.isFinite(mins[i])||!Number.isFinite(maxs[i]))continue;
          ctx.moveTo(LEFT+i+.5,centerY-maxs[i]*scaleY);
          ctx.lineTo(LEFT+i+.5,centerY-mins[i]*scaleY);
        }
        ctx.stroke();
      }
    } else if(!sampleRequested) {
      // Global min/max is a density overview, NOT a reconstructed wave.
      // Low-opacity strokes prevent an opaque turquoise solid when each
      // pixel contains hundreds of complete high-frequency cycles.
      ctx.strokeStyle="rgba(62,185,185,.27)";
      ctx.lineWidth=1;
      ctx.beginPath();
      for(let i=0;i<points.length;i++){
        const p=points[i];
        if(!Number.isFinite(p.timeSec)||!Number.isFinite(p.min)||!Number.isFinite(p.max))continue;
        if(p.timeSec<view.start || p.timeSec>view.end)continue;
        const x=xForTime(p.timeSec)+0.5;
        ctx.moveTo(x,centerY-clamp(p.max,-1.1,1.1)*scaleY);
        ctx.lineTo(x,centerY-clamp(p.min,-1.1,1.1)*scaleY);
      }
      ctx.stroke();
      ctx.fillStyle="#b6d4dc";ctx.font="11px system-ui, sans-serif";ctx.textAlign="center";
      if (view.end-view.start>2 && data?.sampleRateHz && view.end-view.start>256/data.sampleRateHz) {
        ctx.fillText("Dense overview · click Samples for the real waveform",LEFT+plotW/2,TOP+14);
      }
    } else {
      ctx.fillStyle="#9bbccc";ctx.font="11px system-ui, sans-serif";ctx.textAlign="center";
      ctx.fillText(chunkLoading?"Loading raw samples…":"Sample detail unavailable",LEFT+plotW/2,centerY);
    }
    if (selection) {
      const a = xForTime(Math.min(selection.start, selection.end));
      const b = xForTime(Math.max(selection.start, selection.end));
      ctx.fillStyle = "rgba(115, 170, 255, 0.23)";
      ctx.fillRect(a, TOP, Math.max(1, b - a), plotH);
      ctx.strokeStyle = "#8cc1ff"; ctx.lineWidth = 1;
      ctx.strokeRect(a, TOP, Math.max(1, b - a), plotH);
    }
    if (cursor != null) {
      const x = xForTime(cursor);
      ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, HEIGHT - BOTTOM);
      ctx.strokeStyle = "#ffd174"; ctx.lineWidth = 1.4; ctx.stroke();
    }
    if (playheadSec!=null && playheadSec>=view.start && playheadSec<=view.end) {
      const x=xForTime(playheadSec);
      ctx.beginPath();ctx.moveTo(x,TOP);ctx.lineTo(x,HEIGHT-BOTTOM);
      ctx.strokeStyle="#ff8c6a";ctx.lineWidth=2;ctx.stroke();
    }
    ctx.restore();
    if (data?.previewLimited) {
      ctx.fillStyle = "#d5b37c"; ctx.textAlign = "right";
      ctx.fillText("PREVIEW ONLY", width - RIGHT - 4, TOP + 12);
    }
  }, [data, points, view, selection, cursor, width, duration, xForTime, playheadSec, chunk, sampleRequested, chunkLoading]);

  // Native non-passive handler allows wheel zoom without scrolling the entire page.
  // React's delegated wheel listeners can be passive in Chromium-based WebViews.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!data || !points.length) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.28 : 1 / 1.28,
        timeFromX(e.clientX - el.getBoundingClientRect().left));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [data, points.length, zoom, timeFromX]);
  function pointerX(event: ReactPointerEvent<HTMLCanvasElement>) {
    return event.clientX - event.currentTarget.getBoundingClientRect().left;
  }
  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!data || points.length === 0) return;
    if (pointerX(e) < LEFT) return;
    const t = timeFromX(pointerX(e));
    dragging.current = t;
    setCursor(t);
    setSelection({ start: t, end: t });
    onCursorChange?.(t);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragging.current == null) return;
    setSelection({ start: dragging.current, end: timeFromX(pointerX(e)) });
  }
  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    dragging.current = null;
    onSelectionChange?.(selection && Math.abs(selection.end-selection.start)>0 ? selection : null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const selectSpan = selection ? Math.abs(selection.end - selection.start) : 0;
  const zoomSelection = () => {
    if (!selection || selectSpan === 0 || !data) return;
    const minSpan = Math.min(duration, 8 / data.sampleRateHz);
    const span = Math.min(duration, Math.max(selectSpan, minSpan));
    const start = clamp(Math.min(selection.start, selection.end), 0, duration - span);
    setView({ start, end: start + span });
    setSelection(null);
    onSelectionChange?.(null);
  };
  const reset = () => {
    setView({ start: 0, end: duration });
    setSelection(null);
    onSelectionChange?.(null);
  };
  const zoomSamples = () => {
    if(!data || !sourcePath)return;
    const span=Math.min(duration,Math.max(256/data.sampleRateHz,0.016));
    const focus=cursor ?? Math.min(duration/2,(view.start+view.end)/2);
    const start=clamp(focus-span/2,0,Math.max(0,duration-span));
    setView({start,end:start+span});
  };
  useImperativeHandle(ref, () => ({
    zoomIn: () => zoom(0.5,(view.start+view.end)/2),
    zoomOut: () => zoom(2,(view.start+view.end)/2),
    fit: reset, zoomSelection, zoomSamples,
    goToStart: () => { setCursor(0); onCursorChange?.(0); moveViewportTo(0); },
    goToEnd: () => { setCursor(duration); onCursorChange?.(duration); moveViewportTo(duration); },
    setCursor: (time:number) => {
      const t=clamp(time,0,duration);
      setCursor(t);onCursorChange?.(t);moveViewportTo(t);
    },
  }));
  function navTime(e: ReactPointerEvent<HTMLDivElement>) {
    const bounds=e.currentTarget.getBoundingClientRect();
    return clamp((e.clientX-bounds.left)/Math.max(1,bounds.width)*duration,0,duration);
  }
  function changeSelection(which: "start"|"end", value: number) {
    if (!Number.isFinite(value)) return;
    const t=clamp(value,0,duration);
    const other=selection ?? {start:t,end:t};
    const next=which==="start" ? {start:t,end:Math.max(t,other.end)} : {start:Math.min(t,other.start),end:t};
    setSelection(next);
    onSelectionChange?.(next);
  }
  return <section className="chart-card waveform-editor">
    <div className="chart-header waveform-header">
      <div><small>01 / WAVEFORM VIEWER</small><h2>Waveform · CH{(data?.selectedChannel ?? 0) + 1}</h2></div>
      <div className="wave-actions">
        <button type="button" title="Zoom to individual sample frames" aria-label="Show sample detail"
          disabled={!data||!sourcePath} onClick={zoomSamples}><Activity size={15}/> Samples</button>
        <button type="button" title="Zoom into selected time range" disabled={!selectSpan}
          onClick={zoomSelection}><ZoomIn size={15}/> Selection</button>
        <button type="button" title="Zoom in" onClick={() => zoom(0.5, (view.start + view.end) / 2)}
          disabled={!data || !points.length}><ZoomIn size={15}/></button>
        <button type="button" title="Zoom out" onClick={() => zoom(2, (view.start + view.end) / 2)}
          disabled={!data || !points.length}><ZoomOut size={15}/></button>
        <button type="button" title="Fit entire file" onClick={reset}><Maximize2 size={15}/></button>
      </div>
    </div>
    <div className="wave-navigator" ref={wrap}>
      <div className="wave-navigator-title"><span>Overview / navigator</span><span>{timeText(duration)}</span></div>
      <div className="wave-overview-track" role="slider" aria-label="Navigate audio timeline" tabIndex={data ? 0 : -1}
        aria-valuemin={0} aria-valuemax={duration} aria-valuenow={(view.start+view.end)/2}
        onKeyDown={e => {
          if(e.key==="ArrowLeft"||e.key==="ArrowRight") {e.preventDefault();moveViewportTo((view.start+view.end)/2+(e.key==="ArrowRight"?1:-1)*(view.end-view.start)/5);}
        }}
        onPointerDown={e => { if(!data)return; navDrag.current=true; e.currentTarget.setPointerCapture(e.pointerId);moveViewportTo(navTime(e)); }}
        onPointerMove={e => { if(navDrag.current) moveViewportTo(navTime(e)); }}
        onPointerUp={e => { navDrag.current=false; if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => {navDrag.current=false;}}>
        <canvas ref={overview} style={{width:"100%",height:52}} aria-hidden="true"/>
        <div className="wave-navigator-viewport" style={{left:(view.start/duration*100)+"%",width:((view.end-view.start)/duration*100)+"%"}}/>
      </div>
    </div>
    <div className="wave-canvas-wrap">
      <canvas ref={canvas} style={{ width: "100%", height: HEIGHT }} role="img"
        aria-label="Waveform envelope, drag to select a time range; double-click to reset zoom"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={reset}
      />
    </div>
    <div className="wave-selection-view">
      <label><Crosshair size={13}/> Cursor (s)<input aria-label="Cursor time" type="number" step="0.001" min="0" max={duration}
        value={cursor == null ? "" : Number(cursor.toFixed(3))}
        onChange={e=> { if(e.target.value==="")return;const t=clamp(Number(e.target.value),0,duration);setCursor(t);onCursorChange?.(t);moveViewportTo(t); }}/></label>
      <label>Selection in (s)<input aria-label="Selection start" type="number" step="0.001" min="0" max={duration}
        value={selection ? Number(Math.min(selection.start,selection.end).toFixed(3)) : ""}
        onChange={e=>changeSelection("start",Number(e.target.value))}/></label>
      <label>Selection out (s)<input aria-label="Selection end" type="number" step="0.001" min="0" max={duration}
        value={selection ? Number(Math.max(selection.start,selection.end).toFixed(3)) : ""}
        onChange={e=>changeSelection("end",Number(e.target.value))}/></label>
      <span>Duration: {selection ? timeText(Math.abs(selection.end-selection.start)) : "--:--.---"}</span>
    </div>
    <div className="wave-status">
      <span>View: {timeText(view.start)} – {timeText(view.end)}</span>
      <span>{selection && selectSpan > 0 ? "Selection: " + timeText(selectSpan) : "Drag to select · Wheel to zoom · Double-click to fit"}</span>
      <span>{sampleRequested ? (chunk?"RAW SAMPLES · "+chunk.samples.length.toLocaleString()+" frames":chunkLoading?"Loading samples…":"Samples unavailable") : "MIN/MAX OVERVIEW · zoom for samples"}</span>
    </div>
  </section>;
});
export default WaveformView;
