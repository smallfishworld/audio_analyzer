// M0 FFmpeg capability spike: generates and round-trips common codecs.
// Requires ffmpeg + ffprobe already installed on the validation machine.
// This is NOT proof of legal redistributability or bundled sidecars.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(program, args) {
  const r = spawnSync(program, args, { encoding: "utf8", timeout: 45000 });
  if (r.error || r.status !== 0) {
    throw new Error(program + " failed: " + (r.error?.message ?? r.stderr ?? r.stdout));
  }
  return r.stdout.trim();
}
const dir = mkdtempSync(join(tmpdir(), "audio-analyzer-ffmpeg-"));
try {
  console.log(run("ffmpeg", ["-version"]).split("\n")[0]);
  const wav = join(dir, "ref.wav");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2:sample_rate=48000",
    "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const codecs = [
    ["flac", "ref.flac", "flac"],
    ["mp3", "ref.mp3", "mp3"],
    ["aac", "ref.aac", "aac"],
    ["libopus", "ref.opus", "opus"]
  ];
  for (const [encoder, filename, codec] of codecs) {
    const path = join(dir, filename);
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", encoder, path]);
    if (statSync(path).size === 0) throw new Error("Empty output for " + encoder);
    const result = run("ffprobe", ["-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate", "-of", "json", path]);
    const stream = JSON.parse(result).streams?.[0];
    if (stream?.codec_name !== codec || Number(stream?.sample_rate) !== 48000) {
      throw new Error("Unexpected stream for " + encoder + ": " + result);
    }
    // Decoding into a bounded raw PCM preview proves decoder availability.
    const decoded = join(dir, filename + ".pcm");
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-i", path, "-t", "0.1", "-ac", "1", "-f", "f32le", decoded]);
    if (statSync(decoded).size === 0) throw new Error("Decode failure for " + encoder);
    console.log(encoder + " => " + codec + ": encode + probe + decode OK");
  }
  console.log("All codec spike checks passed (environment-specific only).");
} finally { rmSync(dir, { recursive: true, force: true }); }
