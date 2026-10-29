import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioLines, FolderOpen, Radio, Waves, Gauge, Activity, ChartNoAxesCombined, SlidersHorizontal, ChevronRight } from "lucide-react";
import uPlot from "uplot";
type RawSpec = { sampleRateHz: number; channels: number; sampleFormat: string; endianness: string; byteOffset: number; layout: "interleaved" | "planar" };
type Pt = { timeSec: number; min: number; max: number };
type Bin = { frequencyHz: number; dbfs: number | null };
type Metadata = { container:string; codec:string; sampleRateHz:number; channels:number; durationSeconds:number|null; bitRateBps:number|null; bitsPerSample:number|null; fileBytes:number; audioStreamIndex:number };
type Snapshot = { metadata: Metadata | null; name: string; sourceType: string; sampleRateHz: number; channels: number; analyzedFrames: number; previewLimited: boolean; peakDbfs: number | null; rmsDbfs: number | null; dominantFrequencyHz: number | null; waveform: Pt[]; spectrum: Bin[] };
const initialRaw: RawSpec = { sampleRateHz: 192000, channels: 1, sampleFormat: "s16", endianness: "little", byteOffset: 0, layout: "interleaved" };
function db(n?: number | null) { return n == null ? "−∞" : n.toFixed(2); }
function Chart({ title, kind, data }: { title: string; kind: "wave" | "fft"; data: Snapshot | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !data || (kind === "fft" && data.spectrum.length < 2)) return;
    const wave = kind === "wave";
    const arr: uPlot.AlignedData = wave ?
      [data.waveform.map(p => p.timeSec), data.waveform.map(p => p.min), data.waveform.map(p => p.max)] :
      [data.spectrum.map(p => p.frequencyHz / 1000), data.spectrum.map(p => p.dbfs)];
    const div = ref.current;
    const config: uPlot.Options = {
      width: Math.max(300, div.clientWidth), height: 270,
      cursor: { drag: { x: true, y: false, setScale: true } },
      legend: { show: false },
      scales: { x: { time: false }, y: wave ? { min: -1.1, max: 1.1 } : { min: -120, max: 6 } },
      axes: [
        { stroke: "#91a9c1", grid: { stroke: "#283c52" }, size: 34 },
        { stroke: "#91a9c1", grid: { stroke: "#283c52" }, size: 50 }
      ],
      series: wave ? [
        {}, { stroke: "#218d9d", width: 1, points: { show: false } },
        { stroke: "#47d8e7", width: 1, points: { show: false } }
      ] : [{}, { stroke: "#83b0ff", width: 1.5, points: { show: false }, fill: "#3e71a522" }]
    };
    const plot = new uPlot(config, arr, div);
    const resize = new ResizeObserver(() => plot.setSize({ width: Math.max(300, div.clientWidth), height: 270 }));
    resize.observe(div);
    return () => { resize.disconnect(); plot.destroy(); };
  }, [data, kind]);
  return <section className="chart-card"><div className="chart-header"><div><small>{kind === "wave" ? "01 / TIME DOMAIN" : "02 / FREQUENCY DOMAIN"}</small><h2>{title}</h2></div><span className="chip">{kind === "wave" ? "CHANNEL 1" : "HANN · 4096"}</span></div><div className="plot" ref={ref}/>{kind === "fft" && data && data.spectrum.length < 2 && <p className="plot-empty">At least 4096 samples are required for FFT preview.</p>}</section>;
}
export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [importRaw, setImportRaw] = useState(false);
  const [raw, setRaw] = useState<RawSpec>(() => {
    try {
      const saved = localStorage.getItem("audio-analyzer.raw-v1");
      const value = saved ? JSON.parse(saved) as Partial<RawSpec> : {};
      return { ...initialRaw, ...value };
    } catch { return initialRaw; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ffmpeg, setFfmpeg] = useState("not checked");
  const [settings, setSettings] = useState(false);
  async function demo() {
    setBusy(true); setError("");
    try { setData(await invoke<Snapshot>("analyze_demo")); setPath(null); }
    catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void demo(); void invoke<string>("probe_ffmpeg").then(setFfmpeg).catch(() => setFfmpeg("unavailable")); }, []);
  async function analyze(p: string, spec: RawSpec | null = null) {
    setBusy(true); setError("");
    try { setData(await invoke<Snapshot>("analyze_file", { path: p, rawSpec: spec })); setImportRaw(false); }
    catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function choose() {
    try {
      const p = await open({ multiple: false, directory: false, title: "Open audio file" });
      if (typeof p !== "string") return;
      setPath(p);
      if (/\.(pcm|raw|bin)$/i.test(p)) setImportRaw(true); else await analyze(p);
    } catch(e) { setError(String(e)); }
  }
  function setRawValue(k: keyof RawSpec, v: string) {
    setRaw(old => {
      const updated = { ...old, [k]: ["sampleRateHz","channels","byteOffset"].includes(k) ? Number(v) : v };
      localStorage.setItem("audio-analyzer.raw-v1", JSON.stringify(updated));
      return updated;
    });
  }
  return <div className="shell"><aside className="side">
    <div className="brand"><div className="logo"><AudioLines size={22}/></div><div><b>AUDIO<span>LAB</span></b><small>SIGNAL ANALYZER</small></div></div>
    <div className="side-label">WORKSPACE</div><button className="nav active" onClick={() => setSettings(false)}><ChartNoAxesCombined size={17}/> Overview</button>
    <button className="nav" onClick={() => void choose()}><FolderOpen size={17}/> Open audio</button><button className="nav" onClick={() => void demo()}><Radio size={17}/> Demo signal</button>
    <div className="side-label tools">TOOLS</div><button className="nav" onClick={() => setSettings(!settings)}><SlidersHorizontal size={17}/> Settings</button>
    <div className="side-foot"><div><i/> M0 · PROTOTYPE</div><small>Engineered for precision.</small></div>
  </aside><main><header className="top"><span>Workspace <ChevronRight size={13}/> <b>Signal overview</b></span><em>DESKTOP · LOCAL</em></header><div className="content">
    <div className="hero"><div><small>✧ NEXT-GEN AUDIO INSIGHTS</small><h1>Signal workspace<span>.</span></h1><p>Discover the details hidden inside every waveform.</p></div><button className="primary" onClick={() => void choose()} disabled={busy}><FolderOpen size={17}/> Open audio file</button></div>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError("")}>✕</button></div>}
    {settings && <div className="note"><strong>M1 analysis settings</strong><p>Current preview uses 4096-point Hann FFT at source sample rate. Configurable FFT, resampling and audio export are planned in M2–M3.</p></div>}
    <div className="file"><div className="file-icon"><Waves size={22}/></div><div><strong>{data?.name ?? "Loading…"}</strong><p>{data ? data.sourceType + " · " + (data.sampleRateHz / 1000).toFixed(1) + " kHz · " + data.channels + " ch" : ""}</p>
      {data?.metadata && <p className="metadata">Format: {data.metadata.container} · Codec: {data.metadata.codec}
      {data.metadata.bitRateBps != null ? " · " + Math.round(data.metadata.bitRateBps / 1000) + " kbps" : ""}
      {data.metadata.bitsPerSample != null ? " · " + data.metadata.bitsPerSample + "-bit" : ""}
      {data.metadata.durationSeconds != null ? " · " + data.metadata.durationSeconds.toFixed(2) + " s" : ""}</p>}</div><span className="ready">{busy ? "ANALYZING" : "READY"}</span></div>
    <div className="metrics">
      <div className="metric"><small><Gauge size={17}/> SAMPLE PEAK</small><strong>{db(data?.peakDbfs)} <span>dBFS</span></strong><p>Digital full scale</p></div>
      <div className="metric"><small><Activity size={17}/> RMS LEVEL</small><strong>{db(data?.rmsDbfs)} <span>dBFS</span></strong><p>Preview samples only</p></div>
      <div className="metric"><small><Radio size={17}/> DOMINANT TONE</small><strong>{data?.dominantFrequencyHz == null ? "—" : (data.dominantFrequencyHz / 1000).toFixed(3)} <span>kHz</span></strong><p>FFT peak frequency bin</p></div>
      <div className="metric"><small><Waves size={17}/> SAMPLE RATE</small><strong>{data ? (data.sampleRateHz / 1000).toFixed(1) : "—"} <span>kHz</span></strong><p>Nyquist: {data ? (data.sampleRateHz / 2000).toFixed(1) + " kHz" : "—"}</p></div>
    </div>
    <div className="charts"><Chart title="Waveform · Amplitude" kind="wave" data={data}/><Chart title="FFT Spectrum · dBFS" kind="fft" data={data}/></div>
    <footer><span>● {data ? data.analyzedFrames.toLocaleString() + " frames" + (data.previewLimited ? " · PREVIEW ONLY" : "") : "Awaiting input"}</span><span>{ffmpeg} · M1 PREVIEW</span></footer>
  </div></main>
  {importRaw && <div className="overlay"><div className="dialog"><h2>Import raw PCM</h2><p>Specify original capture format. Raw files have no format header.</p><div className="form">
    <label>Sample rate (Hz)<input type="number" min="1" value={raw.sampleRateHz} onChange={e => setRawValue("sampleRateHz",e.target.value)}/></label>
    <label>Channels<input type="number" min="1" max="16" value={raw.channels} onChange={e => setRawValue("channels",e.target.value)}/></label>
    <label>Sample format<select value={raw.sampleFormat} onChange={e => setRawValue("sampleFormat",e.target.value)}>{["u8","s8","s16","s24","s32","f32","f64"].map(x => <option key={x} value={x}>{x}</option>)}</select></label>
    <label>Byte order<select value={raw.endianness} onChange={e => setRawValue("endianness",e.target.value)}><option value="little">Little endian</option><option value="big">Big endian</option></select></label>
    <label>Header offset<input type="number" min="0" value={raw.byteOffset} onChange={e => setRawValue("byteOffset",e.target.value)}/></label>
    <label>PCM layout<select value={raw.layout} onChange={e => setRawValue("layout",e.target.value)}><option value="interleaved">Interleaved</option><option value="planar">Planar</option></select></label>
    </div><div className="dialog-buttons"><button onClick={() => setImportRaw(false)}>Cancel</button><button className="primary" disabled={busy} onClick={() => path && void analyze(path,raw)}>Analyze PCM</button></div></div></div>}
  </div>;
}
