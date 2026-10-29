// Generate short synthetic PCM/codec fixtures. Never commit copyrighted audio.
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const dir = resolve(process.env.AUDIO_ANALYZER_FIXTURES ?? "tests/fixtures/generated");
mkdirSync(dir, { recursive: true });
const formats = [
  ["reference.wav", "pcm_s16le"], ["reference.aiff", "pcm_s16be"],
  ["reference.flac", "flac"], ["reference.mp3", "libmp3lame"],
  ["reference.aac", "aac"], ["reference.m4a", "aac"],
  ["reference.ogg", "libvorbis"], ["reference.opus", "libopus"]
];
for (const [name, encoder] of formats) {
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.6",
    "-ac", "2", "-c:a", encoder, join(dir, name)];
  const result = spawnSync("ffmpeg", args, { encoding:"utf8", timeout:30000 });
  if (result.error || result.status !== 0) {
    throw new Error("Failed to generate " + name + ": " + (result.error?.message ?? result.stderr));
  }
  console.log("Generated:", name, encoder);
}
