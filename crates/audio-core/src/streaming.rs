//! Streaming, full-file native WAV/RAW PCM analysis.
//!
//! Peak, RMS and an overview envelope cover every selected-channel frame.
//! Only the 4096-frame FFT window and at most 1200 waveform buckets are kept
//! in RAM. FFT is explicitly windowed, not falsely described as full-file FFT.
use super::{analyze, level, validate, AnalysisSnapshot, AudioMetadata, RawSpec, WavePoint, FFT_N};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

const CHUNK_FRAMES: usize = 8192;
const WAVE_BUCKETS: u64 = 1200;

struct FullFileAccumulator {
    total: u64,
    rate: u32,
    channel: usize,
    start: u64,
    stride: u64,
    seen: u64,
    peak: f64,
    sum_squares: f64,
    wave: Vec<WavePoint>,
    fft_samples: Vec<f64>,
}

impl FullFileAccumulator {
    fn new(total: u64, rate: u32, channel: usize, start_seconds: f64) -> Result<Self, String> {
        if total == 0 { return Err("Audio contains no complete frames".into()); }
        if !start_seconds.is_finite() || start_seconds < 0.0 {
            return Err("FFT start must be a finite non-negative time".into());
        }
        if total > usize::MAX as u64 { return Err("Too many PCM frames".into()); }
        let max_start = total.saturating_sub(FFT_N as u64);
        let start = ((start_seconds * rate as f64).floor() as u64).min(max_start);
        Ok(Self {
            total, rate, channel, start,
            stride: total.saturating_add(WAVE_BUCKETS - 1) / WAVE_BUCKETS,
            seen: 0, peak: 0.0, sum_squares: 0.0,
            wave: Vec::with_capacity(WAVE_BUCKETS as usize),
            fft_samples: Vec::with_capacity(FFT_N),
        })
    }

    fn push(&mut self, sample: f64) -> Result<(), String> {
        if !sample.is_finite() { return Err("PCM contains NaN or infinity".into()); }
        if self.seen >= self.total { return Err("Audio exceeded expected frame count".into()); }
        self.peak = self.peak.max(sample.abs());
        self.sum_squares += sample * sample;
        if self.seen % self.stride == 0 {
            self.wave.push(WavePoint {
                time_sec: self.seen as f64 / self.rate as f64,
                min: sample, max: sample,
            });
        } else if let Some(bucket) = self.wave.last_mut() {
            bucket.min = bucket.min.min(sample);
            bucket.max = bucket.max.max(sample);
        }
        if self.seen >= self.start && self.seen - self.start < FFT_N as u64 {
            self.fft_samples.push(sample);
        }
        self.seen += 1;
        Ok(())
    }

    fn finish(self, name: &str, source: &str, channels: u16, meta: AudioMetadata) -> Result<AnalysisSnapshot, String> {
        if self.seen != self.total { return Err("Unexpected end of PCM stream".into()); }
        // Reuse the exact same Hann FFT/dBFS implementation as the short preview.
        let mut snapshot = analyze(name, source, self.rate, channels, &self.fft_samples, false)?;
        snapshot.analyzed_frames = self.total as usize;
        snapshot.peak_dbfs = level(self.peak);
        snapshot.rms_dbfs = level((self.sum_squares / self.total as f64).sqrt());
        snapshot.waveform = self.wave;
        snapshot.preview_limited = false;
        snapshot.selected_channel = self.channel;
        snapshot.fft_window_start_sec = Some(self.start as f64 / self.rate as f64);
        snapshot.metadata = Some(meta);
        Ok(snapshot)
    }
}

pub(crate) fn width(format: &str) -> Result<usize, String> {
    match format {
        "u8" | "s8" => Ok(1),
        "s16" => Ok(2),
        "s24" => Ok(3),
        "s32" | "f32" => Ok(4),
        "f64" => Ok(8),
        _ => Err("Unsupported PCM sample format".into()),
    }
}

pub(crate) fn sample_value(format: &str, little: bool, b: &[u8]) -> f64 {
    match format {
        "u8" => (b[0] as f64 - 128.0) / 128.0,
        "s8" => (b[0] as i8 as f64) / 128.0,
        "s16" => (if little { i16::from_le_bytes([b[0], b[1]]) }
                  else { i16::from_be_bytes([b[0], b[1]]) }) as f64 / 32768.0,
        "s24" => {
            let u = if little {
                (b[0] as i32) | ((b[1] as i32) << 8) | ((b[2] as i32) << 16)
            } else {
                (b[2] as i32) | ((b[1] as i32) << 8) | ((b[0] as i32) << 16)
            };
            ((u << 8) >> 8) as f64 / 8388608.0
        }
        "s32" => (if little { i32::from_le_bytes(b.try_into().unwrap()) }
                  else { i32::from_be_bytes(b.try_into().unwrap()) }) as f64 / 2147483648.0,
        "f32" => (if little { f32::from_le_bytes(b.try_into().unwrap()) }
                  else { f32::from_be_bytes(b.try_into().unwrap()) }) as f64,
        "f64" => if little { f64::from_le_bytes(b.try_into().unwrap()) }
                 else { f64::from_be_bytes(b.try_into().unwrap()) },
        _ => unreachable!("format already validated"),
    }
}

pub(super) fn pcm_full(path: &Path, spec: &RawSpec, channel: usize, start_seconds: f64) -> Result<AnalysisSnapshot, String> {
    validate(spec.sample_rate_hz, spec.channels)?;
    if channel >= spec.channels as usize { return Err("Selected PCM channel is out of range".into()); }
    let width = width(&spec.sample_format)?;
    let little = match spec.endianness.as_str() {
        "little" => true, "big" => false,
        _ => return Err("PCM byte order must be little or big".into())
    };
    if spec.layout != "planar" && spec.layout != "interleaved" {
        return Err("PCM layout must be interleaved or planar".into());
    }
    let bytes_per_frame = width * spec.channels as usize;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let bytes = file.metadata().map_err(|e| e.to_string())?.len();
    if spec.byte_offset >= bytes { return Err("PCM byte offset exceeds file size".into()); }
    let remaining_bytes = bytes - spec.byte_offset;
    let total = remaining_bytes / bytes_per_frame as u64;
    let mut acc = FullFileAccumulator::new(total, spec.sample_rate_hz, channel, start_seconds)?;
    let channel_offset = if spec.layout == "planar" {
        total.checked_mul(width as u64).and_then(|n| n.checked_mul(channel as u64))
            .and_then(|n| spec.byte_offset.checked_add(n))
            .ok_or("PCM plane offset overflow")?
    } else { spec.byte_offset };
    let mut input = BufReader::with_capacity(1024 * 1024, file);
    input.seek(SeekFrom::Start(channel_offset)).map_err(|e| e.to_string())?;
    let planar = spec.layout == "planar";
    let unit = if planar { width } else { bytes_per_frame };
    let mut buffer = vec![0u8; CHUNK_FRAMES * unit];
    let mut done = 0u64;
    while done < total {
        let frames = (total - done).min(CHUNK_FRAMES as u64) as usize;
        input.read_exact(&mut buffer[..frames * unit]).map_err(|e| e.to_string())?;
        for i in 0..frames {
            let offset = i * unit + if planar { 0 } else { channel * width };
            acc.push(sample_value(&spec.sample_format, little, &buffer[offset..offset + width]))?;
        }
        done += frames as u64;
    }
    let metadata = AudioMetadata {
        container: "raw".into(), codec: spec.sample_format.clone(),
        sample_rate_hz: spec.sample_rate_hz, channels: spec.channels,
        duration_seconds: Some(total as f64 / spec.sample_rate_hz as f64),
        bit_rate_bps: Some(spec.sample_rate_hz as u64 * bytes_per_frame as u64 * 8),
        bits_per_sample: Some((width * 8) as u16), file_bytes: bytes,
        audio_stream_index: 0,
    };
    acc.finish(&path.file_name().unwrap_or_default().to_string_lossy(),
        &format!("Full raw {} PCM · CH{}", spec.layout, channel + 1), spec.channels, metadata)
}

pub(super) fn wav_full(path: &Path, channel: usize, start_seconds: f64) -> Result<AnalysisSnapshot, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    validate(spec.sample_rate, spec.channels)?;
    if channel >= spec.channels as usize { return Err("Selected WAV channel is out of range".into()); }
    let total = reader.duration() as u64;
    let mut acc = FullFileAccumulator::new(total, spec.sample_rate, channel, start_seconds)?;
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for (i, value) in reader.samples::<f32>().enumerate() {
                let sample = value.map_err(|e| e.to_string())?;
                if i % spec.channels as usize == channel { acc.push(sample as f64)?; }
            }
        }
        hound::SampleFormat::Int => {
            if !(1..=32).contains(&spec.bits_per_sample) {
                return Err("WAV bit depth must be between 1 and 32".into());
            }
            let denom = 2_f64.powi(spec.bits_per_sample as i32 - 1);
            for (i, value) in reader.samples::<i32>().enumerate() {
                let sample = value.map_err(|e| e.to_string())?;
                if i % spec.channels as usize == channel { acc.push(sample as f64 / denom)?; }
            }
        }
    }
    let bytes = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let metadata = AudioMetadata {
        container: "wav".into(), codec: format!("pcm_{}bit", spec.bits_per_sample),
        sample_rate_hz: spec.sample_rate, channels: spec.channels,
        duration_seconds: Some(total as f64 / spec.sample_rate as f64),
        bit_rate_bps: Some(spec.sample_rate as u64 * spec.channels as u64 * spec.bits_per_sample as u64),
        bits_per_sample: Some(spec.bits_per_sample), file_bytes: bytes, audio_stream_index: 0,
    };
    acc.finish(&path.file_name().unwrap_or_default().to_string_lossy(),
        &format!("Full WAV PCM · CH{}", channel + 1), spec.channels, metadata)
}
