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
        if (command === "probe_ffmpeg") return "Bundled FFmpeg OK";
        if (command === "analyze_demo") return snapshot("Demo signal");
        if (command === "plugin:dialog|open") return "/tmp/long_stereo.wav";
        if (command === "analyze_file") return {
          ...snapshot("long_stereo.wav"),
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
