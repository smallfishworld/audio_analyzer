//! Bounded audio preview through a locally available FFmpeg/ffprobe pair.
//! Never invokes a shell, accepts network URLs or silently changes the first channel.
use crate::{analyze, validate, AnalysisSnapshot};
use crate::process::run_bounded;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetadata {
    pub container: String,
    pub codec: String,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub duration_seconds: Option<f64>,
    pub bit_rate_bps: Option<u64>,
    pub bits_per_sample: Option<u16>,
    pub file_bytes: u64,
    pub audio_stream_index: usize,
}

fn bin(name: &str) -> PathBuf {
    let executable = if cfg!(windows) { format!("{name}.exe") } else { name.into() };
    // Prefer a separately audited bundled executable adjacent to the application.
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let bundled = parent.join(&executable);
            if bundled.is_file() { return bundled; }
        }
    }
    // macOS Finder-launched .app processes normally lack Homebrew paths in PATH.
    // Probe common local installations without changing the user's shell settings.
    #[cfg(target_os = "macos")]
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        let candidate = Path::new(directory).join(&executable);
        if candidate.is_file() { return candidate; }
    }
    PathBuf::from(executable) // Development fallback: installed system FFmpeg.
}

pub fn availability() -> String {
    let mut cmd = Command::new(bin("ffprobe"));
    cmd.arg("-version");
    match run_bounded(&mut cmd, Duration::from_secs(3), 16*1024, 4*1024) {
        Ok(output) if output.status.success() =>
            String::from_utf8_lossy(&output.stdout).lines().next()
                .unwrap_or("ffprobe available").chars().take(90).collect(),
        _ => "FFmpeg unavailable: install ffmpeg/ffprobe to analyze compressed files".into()
    }
}

fn number_text(value: &Value, key: &str) -> Option<String> {
    let v = value.get(key)?;
    if let Some(s) = v.as_str() { Some(s.to_string()) }
    else if v.is_number() { Some(v.to_string()) }
    else { None }
}
fn number<T: std::str::FromStr>(value: &Value, key: &str) -> Option<T> {
    number_text(value, key)?.parse::<T>().ok()
}
fn safe_path(path: &Path) -> Result<&Path, String> {
    if !path.is_file() { return Err("Select a readable local audio file".into()); }
    Ok(path)
}
pub fn probe(path: &Path) -> Result<AudioMetadata, String> {
    safe_path(path)?;
    let mut cmd = Command::new(bin("ffprobe"));
    cmd.args(["-v", "error", "-protocol_whitelist", "file",
        "-show_entries",
        "stream=index,codec_type,codec_name,sample_rate,channels,bits_per_raw_sample,bits_per_sample,bit_rate:format=format_name,duration,bit_rate",
        "-of", "json", "--"]).arg(path);
    let output = run_bounded(&mut cmd, Duration::from_secs(15), 1024*1024, 32*1024)?;
    if !output.status.success() {
        return Err(format!("ffprobe could not inspect audio: {}",
            String::from_utf8_lossy(&output.stderr).chars().take(600).collect::<String>()));
    }
    if output.stdout.len() > 1024 * 1024 { return Err("Audio metadata too large".into()); }
    let root: Value = serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid ffprobe output: {e}"))?;
    let stream = root["streams"].as_array().and_then(|items| items.iter()
        .find(|stream| stream["codec_type"].as_str() == Some("audio")))
        .ok_or("File contains no decodable audio stream")?;
    let stream_index = number::<usize>(stream, "index").ok_or("Audio stream has no index")?;
    let sample_rate_hz = number::<u32>(stream, "sample_rate").ok_or("Missing audio sample rate")?;
    let channels = number::<u16>(stream, "channels").ok_or("Missing audio channel count")?;
    validate(sample_rate_hz, channels)?;
    let format = &root["format"];
    let duration_seconds = number::<f64>(format, "duration").filter(|v| v.is_finite() && *v >= 0.0);
    let bits_per_sample = number::<u16>(stream, "bits_per_raw_sample")
        .or_else(|| number::<u16>(stream, "bits_per_sample")).filter(|v| *v > 0);
    Ok(AudioMetadata {
        container: number_text(format, "format_name").unwrap_or_else(|| "unknown".into()),
        codec: number_text(stream, "codec_name").unwrap_or_else(|| "unknown".into()),
        sample_rate_hz, channels, duration_seconds,
        bit_rate_bps: number::<u64>(stream, "bit_rate").or_else(|| number::<u64>(format, "bit_rate")),
        bits_per_sample, file_bytes: std::fs::metadata(path).map_err(|e| e.to_string())?.len(),
        audio_stream_index: stream_index
    })
}

pub fn decode_preview(path: &Path) -> Result<AnalysisSnapshot, String> {
    decode_preview_channel(path,0)
}
pub fn decode_preview_channel(path: &Path, channel: usize) -> Result<AnalysisSnapshot, String> {
    let metadata = probe(path)?;
    if channel>=metadata.channels as usize {return Err("Selected audio channel is out of range".into());}
    // No implicit resampling or channel mix: first channel copied via explicit pan mapping.
    let max_frames = (metadata.sample_rate_hz as usize).saturating_mul(3).min(576_000);
    let seconds = max_frames as f64 / metadata.sample_rate_hz as f64;
    let mut cmd = Command::new(bin("ffmpeg"));
    cmd.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
        "-protocol_whitelist", "file", "-i"]).arg(path)
        .args(["-map", &format!("0:{}", metadata.audio_stream_index),
            "-vn", "-sn", "-dn",
            "-af", &format!("pan=mono|c0=c{channel}"), "-t", &format!("{seconds:.8}"),
            "-c:a", "pcm_f64le", "-f", "f64le", "pipe:1"]);
    let output = run_bounded(&mut cmd, Duration::from_secs(30),
        max_frames.saturating_add(2).saturating_mul(8), 32*1024)?;
    if !output.status.success() {
        return Err(format!("Audio decode failed: {}",
            String::from_utf8_lossy(&output.stderr).chars().take(600).collect::<String>()));
    }
    if output.stdout.len() > max_frames.saturating_add(2).saturating_mul(8) {
        return Err("Decoder returned more data than the preview budget".into());
    }
    if output.stdout.is_empty() || output.stdout.len() % 8 != 0 {
        return Err("Decoder returned empty or incomplete PCM".into());
    }
    let mut samples = Vec::with_capacity(output.stdout.len()/8);
    for chunk in output.stdout.chunks_exact(8) {
        let bytes: [u8;8] = chunk.try_into().map_err(|_| "Invalid decoded float width")?;
        samples.push(f64::from_le_bytes(bytes));
    }
    let filename = path.file_name().map(|v| v.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".into());
    let limited = metadata.duration_seconds.map(|v| v > seconds + 0.005).unwrap_or(true);
    let mut snapshot = analyze(&filename,
        &format!("{} · {} · first channel", metadata.container, metadata.codec),
        metadata.sample_rate_hz, metadata.channels, &samples, limited)?;
    snapshot.metadata = Some(metadata);
    snapshot.selected_channel = channel;
    Ok(snapshot)
}
