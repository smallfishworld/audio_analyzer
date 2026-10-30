import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Test React UI against deterministic, read-only Tauri IPC responses.
  // This is a *browser UI* test; native WebView2/WKWebView testing remains separate.
  await page.addInitScript(() => {
    const waveform = Array.from({ length: 500 }, (_, i) => {
      const amplitude = 0.1 + 0.85 * Math.abs(Math.sin(i * 0.07));
      return { timeSec: i * 0.01, min: -amplitude, max: amplitude };
    });
    const spectrum = Array.from({ length: 129 }, (_, i) => ({
      frequencyHz: i * 250, dbfs: -80 + 60 * Math.exp(-Math.pow((i - 16) / 5, 2)),
    }));
    const snapshot = (name: string) => ({
      name, sourceType: "WAV PCM", sampleRateHz: 32000, channels: 2,
      selectedChannel: 0, analyzedFrames: 160000, previewLimited: false,
      fftWindowStartSec: 0,
      metadata: {
        container: "wav", codec: "pcm_s16le", sampleRateHz: 32000, channels: 2,
        durationSeconds: 5, bitRateBps: 1024000, bitsPerSample: 16,
        fileBytes: 320044, audioStreamIndex: 0,
      },
      peakDbfs: -0.2, rmsDbfs: -6.02, dominantFrequencyHz: 4000,
      waveform, spectrum,
    });
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "analyze_range") {
          const fft=(args?.fftSize as number)??4096;
          return {
            startSec:args?.startSec??0,endSec:((args?.startSec as number)??0)+((args?.durationSec as number)??2),
            sampleRateHz:32000,fftSize:fft,window:args?.windowName??"hann",
            peakDbfs:-0.2,rmsDbfs:-3.01,
            spectrum,peaks:[{frequencyHz:4000,dbfs:-1.2}],
            spectrogram:{startSec:0,endSec:2,nyquistHz:16000,
              columns:Array.from({length:64},(_,x)=>Array.from({length:256},(_,y)=>
                localStorage.getItem("fixture_dense_waveform")==="yes"
                  ? y===64?0:-115
                  : -110+110*Math.exp(-Math.pow((y-64-x/4)/15,2))))}
          };
        }
        if(command==="audio_chunk"||command==="waveform_samples")return {startSec:args?.startSec??0,sampleRateHz:32000,
          samples:Array.from({length:8192},(_,i)=>
            localStorage.getItem("fixture_dense_waveform")==="yes"
              ? Math.sin(2*Math.PI*4000*i/32000)
              : 0.1*Math.sin(i/10))};
        if (command === "probe_ffmpeg") return "Bundled FFmpeg OK";
        if (command === "analyze_demo") return snapshot("Demo signal");
        if (command === "plugin:dialog|open") return "/tmp/long_stereo.wav";
        if (command === "analyze_file") return {
          ...snapshot("long_stereo.wav"),
          ...(localStorage.getItem("fixture_dense_waveform")==="yes" ? {
            name:"test_4kHz_0dB.wav",
            analyzedFrames:1920000,
            waveform:Array.from({length:1200},(_,i)=>({timeSec:i*0.05,min:-1,max:1})),
            metadata:{...snapshot("long_stereo.wav").metadata,durationSeconds:60}
          } : {}),
          selectedChannel: (args?.channelIndex as number) ?? 0,
          fftWindowStartSec: (args?.windowStartSec as number) ?? 0,
        };
        throw new Error("Unexpected IPC command: " + command);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("Demo signal", { exact: true }).first()).toBeVisible();
});

test("dock layout prioritizes Files / Waveform / Frequency Analysis", async ({ page }) => {
  const left = await page.locator(".ws-files").boundingBox();
  const center = await page.locator(".ws-editor").boundingBox();
  const right = await page.locator(".ws-inspector").boundingBox();
  expect(left && center && right).toBeTruthy();
  expect(left!.x + left!.width).toBeLessThanOrEqual(center!.x + 2);
  expect(center!.x + center!.width).toBeLessThanOrEqual(right!.x + 2);
  await expect(page.getByRole("heading", { name: /Waveform/i })).toBeVisible();
  await expect(page.getByText("Frequency Analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Amplitude Statistics", { exact: true })).toBeVisible();
  const canvas = page.getByRole("img", { name: /Waveform envelope/i });
  await expect(canvas).toBeVisible();
  await expect(page.locator(".wave-navigator-viewport")).toBeVisible();
  await page.screenshot({ path: "test-results/analysis-workspace.png" });
});

test("zoom, navigator, selection and global keyboard shortcuts operate", async ({ page }) => {
  const nav = page.locator(".wave-navigator-viewport");
  const fullWidth = (await nav.boundingBox())!.width;
  await page.getByRole("button", { name: "Zoom in (+)" }).click();
  expect((await nav.boundingBox())!.width).toBeLessThan(fullWidth);
  await page.keyboard.press("End");
  await expect(page.getByLabel("Cursor time")).toHaveValue("5");
  await page.keyboard.press("Home");
  await expect(page.getByLabel("Cursor time")).toHaveValue("0");
  const c = (await page.getByRole("img", { name: /Waveform envelope/i }).boundingBox())!;
  await page.mouse.move(c.x + 120, c.y + 160);
  await page.mouse.down();
  await page.mouse.move(c.x + 350, c.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Zoom to selection" })).toBeEnabled();
  await page.getByRole("button", { name: "Zoom to selection" }).click();
  await page.keyboard.press("Escape");
  expect((await nav.boundingBox())!.width).toBeGreaterThan(fullWidth * 0.95);
});

test("open file and channel switching preserve actionable files panel", async ({ page }) => {
  await page.getByRole("button", { name: /Open Ctrl|Open ⌘/ }).click();
  await expect(page.locator(".ws-editor-tab")).toContainText("long_stereo.wav");
  await expect(page.locator(".ws-files")).toContainText("long_stereo.wav");
  await page.getByLabel("Selected audio channel").selectOption("1");
  await expect(page.getByRole("heading", { name: "Waveform · CH2" })).toBeVisible();
  await page.getByRole("button", { name: "Analysis panels" }).click();
  await expect(page.locator(".ws-inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Analysis panels" }).click();
  await expect(page.getByText("Frequency Analysis", { exact: true })).toBeVisible();
});

test("waveform draws actual envelope pixels and narrow inspector remains operable", async ({page}) => {
  const colored = await page.locator(".wave-canvas-wrap canvas").evaluate((canvas) => {
    const element=canvas as HTMLCanvasElement;
    const ctx=element.getContext("2d");
    if(!ctx) return 0;
    const {data}=ctx.getImageData(0,0,element.width,element.height);
    let count=0;
    for(let i=0;i<data.length;i+=4) {
      // Detect visible turquoise sample/envelope strokes, not a solid fill.
      if(data[i+1]>58 && data[i+1]-data[i]>22 && data[i+2]-data[i]>25)count++;
    }
    return count;
  });
  expect(colored).toBeGreaterThan(1000);
  await page.setViewportSize({width:900,height:700});
  await expect(page.locator(".ws-inspector")).toBeVisible();
  await page.getByRole("button",{name:"Analysis panels"}).click();
  await expect(page.locator(".ws-inspector")).toHaveCount(0);
  await page.getByRole("button",{name:"Analysis panels"}).click();
  await expect(page.locator(".ws-inspector")).toBeVisible();
});

test("P1 spectral settings, selection peaks and P2 time-frequency navigation", async ({page}) => {
  await page.getByRole("button", {name: /Open Ctrl|Open ⌘/}).click();
  await expect(page.getByText("STFT", {exact:false}).first()).toBeVisible();
  await expect(page.getByRole("img", {name:"STFT time frequency spectrogram"})).toBeVisible();
  await page.getByLabel("FFT size").selectOption("8192");
  await page.getByLabel("FFT window type").selectOption("blackman");
  await page.getByRole("button", {name:"Analyze window"}).click();
  await expect(page.getByText("FFT · blackman 8192")).toBeVisible();
  await expect(page.getByText("Top spectral peaks")).toBeVisible();
  await page.getByRole("button",{name:/4.000 kHz/}).click();
  await expect(page.getByText(/Frequency cursor: 4000/)).toBeVisible();
  const plot=page.getByRole("img",{name:"STFT time frequency spectrogram"});
  await plot.click({position:{x:25,y:80}});
  await expect(page.getByLabel("Cursor time")).not.toHaveValue("0");
});

test("P2 read-only audition supports play, pause and stop",async ({page})=>{
  await page.getByRole("button", {name: /Open Ctrl|Open ⌘/}).click();
  const play=page.getByRole("button",{name:"Play audio"});
  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.getByRole("button",{name:"Pause playback"})).toBeVisible();
  await page.getByRole("button",{name:"Pause playback"}).click();
  await expect(page.getByRole("button",{name:"Play audio"})).toBeVisible();
  await page.getByRole("button",{name:"Stop playback"}).click();
  await expect(page.getByText("Playhead", {exact:false})).toBeVisible();
});

test("60-second 4kHz PCM uses real sample cycles instead of a filled rectangle",async ({page})=>{
  await page.evaluate(()=>localStorage.setItem("fixture_dense_waveform","yes"));
  await page.getByRole("button",{name:/Open Ctrl|Open ⌘/}).click();
  await expect(page.getByRole("heading",{name:"Waveform · CH1"})).toBeVisible();
  await expect(page.getByText(/RAW SAMPLES ·/)).toBeVisible();
  const nav=page.locator(".wave-navigator-viewport");
  expect((await nav.boundingBox())!.width).toBeLessThan(10);
  const canvas=page.locator(".wave-canvas-wrap canvas");
  const colored=await canvas.evaluate(element=>{
    const el=element as HTMLCanvasElement;
    const data=el.getContext("2d")!.getImageData(0,0,el.width,el.height).data;
    let count=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i+1]>150 && data[i+2]>150 && data[i+1]>data[i]+25)count++;
    }
    return {count,area:el.width*el.height};
  });
  expect(colored.count).toBeGreaterThan(1200);
  expect(colored.count/colored.area).toBeLessThan(0.35);
  await page.getByRole("button",{name:"Fit entire file",exact:true}).click();
  await expect(page.getByText(/MIN\/MAX OVERVIEW/)).toBeVisible();
  await page.getByRole("button",{name:"Show sample detail"}).first().click();
  await expect(page.getByText(/RAW SAMPLES ·/)).toBeVisible();
});

test("4kHz pure tone STFT is a bright ridge on a dark floor",async ({page})=>{
  await page.evaluate(()=>localStorage.setItem("fixture_dense_waveform","yes"));
  await page.getByRole("button",{name:/Open Ctrl|Open ⌘/}).click();
  const canvas=page.getByRole("img",{name:"STFT time frequency spectrogram"});
  await expect(canvas).toBeVisible();
  const colors=await canvas.evaluate(node=>{
    const el=node as HTMLCanvasElement;
    const {data}=el.getContext("2d")!.getImageData(0,0,el.width,el.height);
    let dark=0,bright=0;
    for(let i=0;i<data.length;i+=4){
      if(data[i]<40 && data[i+1]<45 && data[i+2]<60)dark++;
      if(data[i]>225 && data[i+1]>130 && data[i+2]>60)bright++;
    }
    return {dark,bright,total:el.width*el.height};
  });
  expect(colors.dark/colors.total).toBeGreaterThan(0.90);
  expect(colors.bright).toBeGreaterThan(0);
});
