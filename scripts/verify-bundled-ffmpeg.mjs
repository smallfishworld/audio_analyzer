// Integration smoke test for the actual standalone FFmpeg executables in the installer.
// No shell, network access, non-free codec dependencies or copyrighted test audio.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ffmpeg = process.env.AUDIO_ANALYZER_FFMPEG;
const ffprobe = process.env.AUDIO_ANALYZER_FFPROBE;
if (!ffmpeg || !ffprobe) throw Error("Bundled AUDIO_ANALYZER_FFMPEG and AUDIO_ANALYZER_FFPROBE paths are required");

function run(exe, args, binary = false) {
  const result = spawnSync(exe, args, { encoding: binary ? null : "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw Error(exe + " " + args.join(" ") + " failed: " + (result.error?.message ?? result.stderr?.toString() ?? "unknown"));
  }
  return result.stdout;
}
for (const exe of [ffmpeg, ffprobe]) {
  const version = run(exe, ["-version"]).toString().split("\n")[0];
  if (!version.includes("9.0.2")) throw Error("Unexpected bundled FFmpeg version: " + version);
  const license = run(exe, ["-L"]).toString();
  if (!/LGPL|Lesser General Public License/i.test(license)) throw Error("Missing LGPL license");
  const flags = run(exe, ["-buildconf"]).toString();
  if (/(--enable-gpl|--enable-nonfree)(?:\s|$)/.test(flags)) throw Error("Forbidden GPL/nonfree FFmpeg build options");
  console.log(version);
}
const folder = mkdtempSync(join(tmpdir(), "aa-bundled-ffmpeg-"));
try {
  for (const [ext, codec] of [["wav","pcm_s16le"],["flac","flac"],["m4a","aac"]]) {
    const file = join(folder, "reference." + ext);
    run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=1200:sample_rate=48000:duration=0.25",
      "-ac", "1", "-c:a", codec, file]);
    if (!statSync(file).size) throw Error("Output empty: " + ext);
    const info = JSON.parse(run(ffprobe, ["-v","error","-select_streams","a:0","-show_entries",
      "stream=codec_name,sample_rate,channels", "-of","json",file]));
    const stream = info.streams?.[0];
    if (stream?.codec_name !== codec || Number(stream.sample_rate) !== 48000 || Number(stream.channels) !== 1) {
      throw Error("Incorrect probe result for " + ext + ": " + JSON.stringify(stream));
    }
    const pcm = run(ffmpeg, ["-nostdin", "-v","error","-i",file,
      "-map","0:a:0","-af","pan=mono|c0=c0","-t","0.15","-c:a","pcm_f64le","-f","f64le","pipe:1"],true);
    if (pcm.length < 8 * 4096 || pcm.length % 8 !== 0) throw Error("Decoded f64le invalid for " + ext);
    console.log(ext + ": encode, probe, decode f64le passed (" + pcm.length + " bytes)");
  }
} finally { rmSync(folder, {recursive:true, force:true}); }
