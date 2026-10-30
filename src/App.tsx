import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioLines, FolderOpen, Radio, Waves, Gauge, Activity, SlidersHorizontal, ArrowLeftToLine, ArrowRightToLine, ZoomIn, ZoomOut, Maximize2, ScanSearch, FileAudio, ListMusic, Info, X, Crosshair } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import WaveformView from "./WaveformView";
import type { WaveformControls, WaveformRange } from "./WaveformView";
type RawSpec = { sampleRateHz: number; channels: number; sampleFormat: string; endianness: string; byteOffset: number; layout: "interleaved" | "planar" };
type RawCandidate = { sampleFormat: string; endianness: string; score: number };
type RawDetection = { suggested: RawSpec; confidence: "filename" | "heuristic" | "unknown"; inferredFields: string[]; reasons: string[]; candidates: RawCandidate[]; fileBytes: number };
type Pt = { timeSec: number; min: number; max: number };
type Bin = { frequencyHz: number; dbfs: number | null };
type Metadata = { container:string; codec:string; sampleRateHz:number; channels:number; durationSeconds:number|null; bitRateBps:number|null; bitsPerSample:number|null; fileBytes:number; audioStreamIndex:number };
type Snapshot = { metadata: Metadata | null; selectedChannel: number; fftWindowStartSec: number | null; name: string; sourceType: string; sampleRateHz: number; channels: number; analyzedFrames: number; previewLimited: boolean; peakDbfs: number | null; rmsDbfs: number | null; dominantFrequencyHz: number | null; waveform: Pt[]; spectrum: Bin[] };
const initialRaw: RawSpec = { sampleRateHz: 192000, channels: 1, sampleFormat: "s16", endianness: "little", byteOffset: 0, layout: "interleaved" };
function db(n?: number | null) { return n == null ? "−∞" : n.toFixed(2); }
function SpectrumPanel({ data }: { data: Snapshot | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const div=ref.current;
    if (!div || !data || data.spectrum.length < 2) return;
    const values: uPlot.AlignedData = [
      data.spectrum.map(p => p.frequencyHz / 1000),
      data.spectrum.map(p => p.dbfs)
    ];
    const config: uPlot.Options = {
      width:Math.max(280,div.clientWidth),height:245,
      cursor:{drag:{x:true,y:false,setScale:true}},
      legend:{show:false},
      scales:{x:{time:false},y:{min:-120,max:6}},
      axes:[
        {stroke:"#93a9bb",grid:{stroke:"#283c52"},size:35,label:"Frequency (kHz)",labelSize:14},
        {stroke:"#93a9bb",grid:{stroke:"#283c52"},size:49,label:"dBFS",labelSize:13}
      ],
      series:[{}, {stroke:"#54d7d5",width:1.6,points:{show:false},fill:"#3e71a522"}]
    };
    const chart = new uPlot(config,values,div);
    const observer = new ResizeObserver(() => chart.setSize({width:Math.max(280,div.clientWidth),height:245}));
    observer.observe(div);
    return () => {observer.disconnect();chart.destroy();};
  },[data]);
  return <section className="panel-section spectrum-panel">
    <header className="panel-title"><span>Frequency Analysis</span><span className="panel-subtle">FFT · Hann 4096</span></header>
    <div className="plot" ref={ref}/>
    {(!data || data.spectrum.length < 2) && <p className="plot-empty">A valid FFT needs at least 4096 frames.</p>}
    <div className="panel-help">Selected channel · frequency in kHz · amplitude in dBFS</div>
  </section>;
}
type HistoryEntry = { path: string; name: string; raw: RawSpec | null };
function basename(path: string) { return path.split(/[\\/]/).pop() || path; }
function secs(t: number) {
  const n=Math.max(0,t);
  const m=Math.floor(n/60);
  return String(m).padStart(2,"0")+":"+(n%60).toFixed(3).padStart(6,"0");
}
export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [importRaw, setImportRaw] = useState(false);
  const [detectingRaw, setDetectingRaw] = useState(false);
  const [rawDetection, setRawDetection] = useState<RawDetection | null>(null);
  const [rawDetectionError, setRawDetectionError] = useState("");
  const [rawUserEdited, setRawUserEdited] = useState(false);
  const detectorRequest = useRef(0);
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
  const [fftStartSec, setFftStartSec] = useState(0);
  const request = useRef(0);
  const waveRef=useRef<WaveformControls>(null);
  const [recent, setRecent]=useState<HistoryEntry[]>([]);
  const [cursorSec, setCursorSec]=useState(0);
  const [range, setRange]=useState<WaveformRange>(null);
  const [showInspector, setShowInspector]=useState(true);
  function addHistory(p:string,spec:RawSpec|null) {
    setRecent(list => [{path:p,name:basename(p),raw:spec},...list.filter(x=>x.path!==p)].slice(0,12));
  }
  async function demo() {
    const token=++request.current;
    setBusy(true); setError("");
    try {
      const response=await invoke<Snapshot>("analyze_demo");
      if (token===request.current) { setData(response); setPath(null); setFftStartSec(0); setCursorSec(0); setRange(null); }
    } catch(e) { if (token===request.current) setError(String(e)); }
    finally { if (token===request.current) setBusy(false); }
  }
  useEffect(() => { void demo(); void invoke<string>("probe_ffmpeg").then(setFfmpeg).catch(() => setFfmpeg("unavailable")); }, []);
  async function analyze(p: string, spec: RawSpec | null = null, channelIndex = 0, windowStartSec = 0) {
    const token=++request.current;
    setBusy(true); setError("");
    try {
      const response=await invoke<Snapshot>("analyze_file", { path: p, rawSpec: spec, channelIndex, windowStartSec });
      if (token===request.current) { setData(response); setImportRaw(false); setFftStartSec(response.fftWindowStartSec ?? 0); addHistory(p,spec); }
    } catch(e) { if (token===request.current) setError(String(e)); }
    finally { if (token===request.current) setBusy(false); }
  }
  async function detectRaw(p: string, previous: RawSpec) {
    const token = ++detectorRequest.current;
    setDetectingRaw(true);
    setRawDetectionError("");
    setRawDetection(null);
    setRawUserEdited(false);
    try {
      const detection = await invoke<RawDetection>("detect_raw_pcm", { path: p, previous });
      if (token !== detectorRequest.current) return;
      setRawDetection(detection);
      setRaw(detection.suggested);
    } catch(e) {
      if (token === detectorRequest.current) setRawDetectionError(String(e));
    } finally {
      if (token === detectorRequest.current) setDetectingRaw(false);
    }
  }
  function applyRawCandidate(candidate: RawCandidate) {
    setRaw(old => ({...old, sampleFormat: candidate.sampleFormat, endianness: candidate.endianness}));
    setRawUserEdited(true);
  }
  async function openFile(p:string, knownRaw:RawSpec|null=null) {
    ++request.current; // Invalidate an older demo/open/analysis response immediately.
    ++detectorRequest.current;
    setBusy(false);setError("");setData(null);setRange(null);setCursorSec(0);
    setPath(p);setFftStartSec(0);
    if (/\.(pcm|raw|bin)$/i.test(p)) {
      if (knownRaw) {
        setRaw(knownRaw);
        setImportRaw(false);
        await analyze(p,knownRaw);
      } else {
        setImportRaw(true);
        void detectRaw(p,raw);
      }
    } else {
      setImportRaw(false);setRawDetection(null);
      await analyze(p);
    }
  }
  async function choose() {
    try {
      const p=await open({multiple:false,directory:false,title:"Open audio for analysis"});
      if(typeof p==="string") await openFile(p);
    } catch(e) {setError(String(e));}
  }
  useEffect(() => {
    const handle=(e:KeyboardEvent) => {
      const target=e.target as HTMLElement|null;
      if(target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="o") {
        e.preventDefault();void choose();return;
      }
      if(importRaw || !data) return;
      if(e.key==="Escape") {e.preventDefault();waveRef.current?.fit();}
      else if(e.key==="Home") {e.preventDefault();waveRef.current?.goToStart();}
      else if(e.key==="End") {e.preventDefault();waveRef.current?.goToEnd();}
      else if(e.key==="=" || e.key==="+") {e.preventDefault();waveRef.current?.zoomIn();}
      else if(e.key==="-") {e.preventDefault();waveRef.current?.zoomOut();}
    };
    window.addEventListener("keydown",handle);
    return () => window.removeEventListener("keydown",handle);
  });
  function setRawValue(k: keyof RawSpec, v: string) {
    setRawUserEdited(true);
    setRaw(old => {
      const updated = { ...old, [k]: ["sampleRateHz","channels","byteOffset"].includes(k) ? Number(v) : v };
      localStorage.setItem("audio-analyzer.raw-v1", JSON.stringify(updated));
      return updated;
    });
  }
  return <div className="shell workstation">
    <header className="ws-topbar">
      <div className="ws-brand"><div className="ws-logo"><AudioLines size={19}/></div><b>Audio Analyzer</b><span>Read-only analysis</span></div>
      <div className="ws-top-actions">
        <button type="button" onClick={()=>void choose()}><FolderOpen size={15}/> Open <kbd>⌘/Ctrl O</kbd></button>
        <button type="button" onClick={()=>void demo()}><Radio size={15}/> Demo</button>
        <button type="button" className={showInspector?"ws-active":""} onClick={()=>setShowInspector(x=>!x)}><SlidersHorizontal size={15}/> Analysis panels</button>
      </div>
      <span className="ws-state">{busy?"ANALYZING…":"LOCAL · OFFLINE"}</span>
    </header>
    <div className={"ws-body"+(!showInspector?" no-inspector":"")}>
      <aside className="ws-files">
        <header className="panel-title"><span><ListMusic size={15}/> Files</span><span className="panel-subtle">{recent.length}</span></header>
        <button type="button" className={"file-list-item"+(!path?" selected":"")} onClick={()=>void demo()}><Radio size={15}/><span>Demo signal<small>Generated reference</small></span></button>
        {recent.length===0 && <p className="ws-empty-files">Open a WAV, PCM, MP3 or another audio file to inspect it.</p>}
        {recent.map(item=><button type="button" title={item.path} key={item.path}
          className={"file-list-item"+(path===item.path?" selected":"")} onClick={()=>void openFile(item.path,item.raw)}>
          <FileAudio size={16}/><span>{item.name}<small>{item.raw ? "RAW PCM" : "Audio"}</small></span>
        </button>)}
        <div className="ws-files-bottom">
          <button type="button" onClick={()=>void choose()}><FolderOpen size={15}/> Add audio file</button>
          <button type="button" onClick={()=>setSettings(x=>!x)}><Info size={15}/> {settings?"Hide":"Show"} analysis info</button>
          <small>Files are read-only. Nothing is modified.</small>
        </div>
      </aside>
      <main className="ws-editor">
        <div className="ws-editor-tab"><Waves size={15}/><strong title={path??"Synthetic signal"}>{data?.name??(busy?"Analyzing…":"No file selected")}</strong><span>{data?data.channels+" ch · "+(data.sampleRateHz/1000).toFixed(2)+" kHz":""}</span></div>
        {error && <div className="error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError("")}><X size={14}/></button></div>}
        {settings && <div className="note"><strong>Analysis mode — no editing</strong>
          <p>RAW PCM/WAV: full-file min/max waveform and Peak/RMS. Compressed formats may show only a three-second preview. Current FFT is a single 4096-frame window; full-resolution zoom and playback are planned, not yet implemented.</p></div>}
        <div className="ws-editor-heading">
          <span><Waves size={14}/> Waveform viewer</span>
          <span className="ws-muted">{data?.previewLimited?"PREVIEW · FIRST 3 SECONDS":"READ-ONLY · FULL OVERVIEW"}</span>
        </div>
        <WaveformView ref={waveRef} data={data}
          onCursorChange={setCursorSec} onSelectionChange={setRange}/>
        <div className="ws-editor-tools">
          <span>FFT window</span>
          <label>Start (s)<input aria-label="FFT window start" type="number" min="0" step="0.001"
            value={fftStartSec} onChange={e=>setFftStartSec(Number(e.target.value))}/></label>
          <button type="button" disabled={!path||busy||data?.previewLimited}
            onClick={()=>path&&void analyze(path,/\.(pcm|raw|bin)$/i.test(path)?raw:null,data?.selectedChannel??0,fftStartSec)}>
            <ScanSearch size={14}/> Analyze window
          </button>
          <button type="button" disabled={!path||busy||data?.previewLimited}
            onClick={()=>setFftStartSec(cursorSec)}><Crosshair size={14}/> Use cursor</button>
          <span className="ws-muted">4096 frames · current channel</span>
        </div>
        <div className="ws-transport" aria-label="Waveform navigation controls">
          <span className="ws-transport-label">NAVIGATE</span>
          <button type="button" title="Beginning (Home)" onClick={()=>waveRef.current?.goToStart()}><ArrowLeftToLine size={17}/></button>
          <button type="button" title="End (End)" onClick={()=>waveRef.current?.goToEnd()}><ArrowRightToLine size={17}/></button>
          <div className="ws-transport-divider"/>
          <button type="button" title="Zoom in (+)" onClick={()=>waveRef.current?.zoomIn()}><ZoomIn size={17}/></button>
          <button type="button" title="Zoom out (-)" onClick={()=>waveRef.current?.zoomOut()}><ZoomOut size={17}/></button>
          <button type="button" title="Zoom to selection" disabled={!range||Math.abs(range.end-range.start)===0} onClick={()=>waveRef.current?.zoomSelection()}><ScanSearch size={17}/></button>
          <button type="button" title="Fit entire file (Escape)" onClick={()=>waveRef.current?.fit()}><Maximize2 size={17}/></button>
          <div className="ws-transport-time">Cursor <b>{secs(cursorSec)}</b></div>
          <div className="ws-transport-time">Selection <b>{range?secs(Math.abs(range.end-range.start)):"--:--.---"}</b></div>
        </div>
        <div className="ws-editor-meta">
          <span>{data ? data.sourceType+" · "+data.analyzedFrames.toLocaleString()+" analyzed frames" : "Open an audio file to start."}</span>
          <span>Zoom is limited by the cached overview resolution; sample-level LOD is planned.</span>
        </div>
      </main>
      {showInspector && <aside className="ws-inspector">
        <SpectrumPanel data={data}/>
        <section className="panel-section ws-stats">
          <header className="panel-title"><span>Amplitude Statistics</span><span className="panel-subtle">{data?.previewLimited?"Preview":"Full selected channel"}</span></header>
          <div className="ws-stat"><span><Gauge size={13}/> Sample Peak</span><strong>{db(data?.peakDbfs)} <small>dBFS</small></strong></div>
          <div className="ws-stat"><span><Activity size={13}/> RMS Level</span><strong>{db(data?.rmsDbfs)} <small>dBFS</small></strong></div>
          <div className="ws-stat"><span><Radio size={13}/> Dominant frequency</span><strong>{data?.dominantFrequencyHz==null?"—":(data.dominantFrequencyHz/1000).toFixed(3)} <small>kHz</small></strong></div>
          <div className="ws-stat"><span><Waves size={13}/> Sample rate</span><strong>{data?(data.sampleRateHz/1000).toFixed(2):"—"} <small>kHz</small></strong></div>
          <p className="ws-muted ws-stat-note">Peak/RMS and FFT use different measurement windows. Values are digital dBFS, not acoustic dB SPL.</p>
        </section>
        <section className="panel-section ws-properties">
          <header className="panel-title"><span>Properties</span><span className="panel-subtle">Source</span></header>
          <div className="ws-prop"><span>Filename</span><strong>{data?.name??"—"}</strong></div>
          <div className="ws-prop"><span>Codec</span><strong>{data?.metadata?.codec??"—"}</strong></div>
          <div className="ws-prop"><span>Duration</span><strong>{data?.metadata?.durationSeconds==null?"—":secs(data.metadata.durationSeconds)}</strong></div>
          <div className="ws-prop"><span>Channel</span>{data&&data.channels>1&&path
            ? <select aria-label="Selected audio channel" value={data.selectedChannel} disabled={busy}
                onChange={e=>void analyze(path,/\.(pcm|raw|bin)$/i.test(path)?raw:null,Number(e.target.value),fftStartSec)}>
                {Array.from({length:data.channels},(_,i)=><option key={i} value={i}>CH {i+1}</option>)}
              </select>
            : <strong>CH {(data?.selectedChannel??0)+1}</strong>}</div>
          <div className="ws-prop"><span>Bit rate</span><strong>{data?.metadata?.bitRateBps==null?"—":Math.round(data.metadata.bitRateBps/1000)+" kbps"}</strong></div>
        </section>
      </aside>}
    </div>
    <footer className="ws-statusbar"><span>{busy?"● Analyzing…":data?"● Ready":"● No audio"} · {ffmpeg}</span><span>Waveform / Analysis workspace · v0.2.0-alpha.5</span></footer>
  {importRaw && <div className="overlay"><div className="dialog"><h2>Import raw PCM</h2>
    <p>Raw PCM has no header. Format detection is best-effort — check the proposed values before analysis.</p>
    <div className="raw-detection">
      <div className="raw-detection-top">
        <strong>{detectingRaw ? "Checking a small PCM sample…" : rawDetection ? "Automatic suggestions" : "Automatic detection"}</strong>
        <button type="button" className="secondary-btn" disabled={detectingRaw || !path}
          onClick={() => path && void detectRaw(path, raw)}>{detectingRaw ? "Detecting…" : "Re-detect"}</button>
      </div>
      {rawDetection && <>
        <div className="raw-detection-status">
          <span className="raw-confidence">{rawDetection.confidence === "filename" ? "Filename clues" : rawDetection.confidence === "heuristic" ? "Statistical estimate" : "Format uncertain"}</span>
          <span>{(rawDetection.fileBytes / 1024).toFixed(1)} KiB file</span>
          {rawUserEdited && <span className="raw-manual">Manual settings applied</span>}
        </div>
        <p className="raw-inferred">Inferred fields: {rawDetection.inferredFields.length ? rawDetection.inferredFields.join(", ") : "none — previous/default settings retained"}</p>
        {rawDetection.reasons.map((msg,i) => <p className="raw-reason" key={i}>{msg}</p>)}
        {rawDetection.candidates.length > 0 && <div className="raw-candidates">
          <small>Alternative interpretations (not guaranteed):</small>
          <div>{rawDetection.candidates.map((candidate,i) =>
            <button key={candidate.sampleFormat + candidate.endianness} className="raw-candidate"
              type="button" onClick={() => applyRawCandidate(candidate)}
              aria-label={"Try " + candidate.sampleFormat + " " + candidate.endianness}>
              {i+1}. {candidate.sampleFormat.toUpperCase()} {candidate.endianness === "little" ? "LE" : "BE"}
            </button>)}</div>
        </div>}
      </>}
      {rawDetectionError && <p className="raw-warning">Detection unavailable: {rawDetectionError}. You can still set the format manually.</p>}
      {!rawDetection && !rawDetectionError && !detectingRaw && <p className="raw-reason">Set the original capture format, or use Re-detect to estimate it.</p>}
    </div>
    <div className="form">
    <label>Sample rate (Hz)<input type="number" min="1" value={raw.sampleRateHz} onChange={e => setRawValue("sampleRateHz",e.target.value)}/></label>
    <label>Channels<input type="number" min="1" max="16" value={raw.channels} onChange={e => setRawValue("channels",e.target.value)}/></label>
    <label>Sample format<select value={raw.sampleFormat} onChange={e => setRawValue("sampleFormat",e.target.value)}>{["u8","s8","s16","s24","s32","f32","f64"].map(x => <option key={x} value={x}>{x}</option>)}</select></label>
    <label>Byte order<select value={raw.endianness} onChange={e => setRawValue("endianness",e.target.value)}><option value="little">Little endian</option><option value="big">Big endian</option></select></label>
    <label>Header offset<input type="number" min="0" value={raw.byteOffset} onChange={e => setRawValue("byteOffset",e.target.value)}/></label>
    <label>PCM layout<select value={raw.layout} onChange={e => setRawValue("layout",e.target.value)}><option value="interleaved">Interleaved</option><option value="planar">Planar</option></select></label>
    </div><div className="dialog-buttons"><button onClick={() => { ++detectorRequest.current; setImportRaw(false); }}>Cancel</button><button className="primary" disabled={busy || detectingRaw} onClick={() => { if (path) { localStorage.setItem("audio-analyzer.raw-v1",JSON.stringify(raw)); void analyze(path,raw); } }}>Analyze PCM</button></div></div></div>}
  </div>;
}
