import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

type EnvelopePoint = { timeSec: number; min: number; max: number };
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
export default function WaveformView({ data }: { data: WaveData | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const duration = fullDuration(data);
  const [view, setView] = useState<View>({ start: 0, end: duration });
  const [selection, setSelection] = useState<Range | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const points = data?.waveform ?? [];
  useEffect(() => {
    setView({ start: 0, end: duration });
    setSelection(null);
    setCursor(null);
  }, [data, duration]);
  useEffect(() => {
    if (!wrap.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(Math.max(320, Math.floor(entries[0].contentRect.width)));
    });
    obs.observe(wrap.current);
    return () => obs.disconnect();
  }, []);
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
    // Only an envelope is cached. Limit zoom to useful overview resolution:
    // do not claim to provide sample-level detail from these buckets.
    const minSpan = Math.max(duration / 12, 1 / data.sampleRateHz);
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
    // The Rust service already computed min/max envelope buckets. Plot each bucket
    // as its own vertical peak line instead of joining mins/maxes into flat rails.
    ctx.save();
    ctx.beginPath();
    ctx.rect(LEFT, TOP, plotW, plotH);
    ctx.clip();
    const bucketSeconds = duration / Math.max(points.length, 1);
    ctx.fillStyle = "#45d6d8";
    ctx.strokeStyle = "#45d6d8";
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!Number.isFinite(p.timeSec) || !Number.isFinite(p.min) || !Number.isFinite(p.max)) continue;
      const begin = p.timeSec;
      const next = i + 1 < points.length ? points[i + 1].timeSec : Math.min(duration, begin + bucketSeconds);
      if (next < view.start || begin > view.end) continue;
      const x = xForTime(begin);
      const nextX = xForTime(next);
      const yMin = centerY - clamp(p.min, -1.15, 1.15) * scaleY;
      const yMax = centerY - clamp(p.max, -1.15, 1.15) * scaleY;
      const yTop = Math.min(yMin, yMax);
      const h = Math.max(1, Math.abs(yMax - yMin));
      const w = Math.max(1, nextX - x);
      ctx.fillRect(x, yTop, w, h);
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
    ctx.restore();
    if (data?.previewLimited) {
      ctx.fillStyle = "#d5b37c"; ctx.textAlign = "right";
      ctx.fillText("PREVIEW ONLY", width - RIGHT - 4, TOP + 12);
    }
  }, [data, points, view, selection, cursor, width, duration, xForTime]);

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
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragging.current == null) return;
    setSelection({ start: dragging.current, end: timeFromX(pointerX(e)) });
  }
  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const selectSpan = selection ? Math.abs(selection.end - selection.start) : 0;
  const zoomSelection = () => {
    if (!selection || selectSpan === 0 || !data) return;
    const minSpan = Math.max(duration / 12, 1 / data.sampleRateHz);
    const span = Math.min(duration, Math.max(selectSpan, minSpan));
    const start = clamp(Math.min(selection.start, selection.end), 0, duration - span);
    setView({ start, end: start + span });
    setSelection(null);
  };
  const reset = () => { setView({ start: 0, end: duration }); setSelection(null); };
  return <section className="chart-card waveform-editor">
    <div className="chart-header waveform-header">
      <div><small>01 / WAVEFORM EDITOR</small><h2>Waveform · CH{(data?.selectedChannel ?? 0) + 1}</h2></div>
      <div className="wave-actions">
        <button type="button" title="Zoom into selected time range" disabled={!selectSpan}
          onClick={zoomSelection}><ZoomIn size={15}/> Selection</button>
        <button type="button" title="Zoom in" onClick={() => zoom(0.5, (view.start + view.end) / 2)}
          disabled={!data || !points.length}><ZoomIn size={15}/></button>
        <button type="button" title="Zoom out" onClick={() => zoom(2, (view.start + view.end) / 2)}
          disabled={!data || !points.length}><ZoomOut size={15}/></button>
        <button type="button" title="Fit entire file" onClick={reset}><Maximize2 size={15}/></button>
      </div>
    </div>
    <div className="wave-canvas-wrap" ref={wrap}>
      <canvas ref={canvas} style={{ width: "100%", height: HEIGHT }} role="img"
        aria-label="Waveform envelope, drag to select a time range; double-click to reset zoom"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={reset}
      />
    </div>
    <div className="wave-status">
      <span>View: {timeText(view.start)} – {timeText(view.end)}</span>
      <span>{selection && selectSpan > 0 ? "Selection: " + timeText(selectSpan) : "Drag to select · Wheel to zoom · Double-click to fit"}</span>
      <span>Min/max envelope · overview resolution</span>
    </div>
  </section>;
}
