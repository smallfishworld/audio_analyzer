use audio_core::ffmpeg::{decode_preview, probe};
use std::path::PathBuf;
fn fixture(name: &str) -> PathBuf {
    let base = std::env::var("AUDIO_ANALYZER_FIXTURES")
        .unwrap_or_else(|_| "tests/fixtures/generated".into());
    let folder = PathBuf::from(base);
    let folder = if folder.is_absolute() { folder } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join(folder)
    };
    folder.join(name)
}
#[test]
fn all_m1_formats_probe_and_analyze() {
    if std::env::var_os("AUDIO_ANALYZER_RUN_CODEC_TESTS").is_none() {
        eprintln!("Codec fixtures not configured; run CI codec-integration job");
        return;
    }
    let formats = [
        ("reference.wav", "pcm_s16le"),
        ("reference.aiff", "pcm_s16be"),
        ("reference.flac", "flac"),
        ("reference.mp3", "mp3"),
        ("reference.aac", "aac"),
        ("reference.m4a", "aac"),
        ("reference.ogg", "vorbis"),
        ("reference.opus", "opus")
    ];
    for (file, codec) in formats {
        let path = fixture(file);
        let metadata = probe(&path).unwrap_or_else(|e| panic!("{file} probe: {e}"));
        assert_eq!(metadata.codec, codec, "codec: {file}");
        assert_eq!(metadata.sample_rate_hz, 48_000, "rate: {file}");
        assert_eq!(metadata.channels, 2, "channels: {file}");
        assert!(metadata.file_bytes > 0);
        let output = decode_preview(&path).unwrap_or_else(|e| panic!("{file} decode: {e}"));
        assert_eq!(output.sample_rate_hz, 48_000);
        assert_eq!(output.channels, 2);
        assert!(output.analyzed_frames > 4_096, "preview samples: {file}");
        assert!(output.rms_dbfs.unwrap() < 0.0, "RMS expected below 0 dBFS");
        let frequency = output.dominant_frequency_hz.unwrap();
        assert!((frequency - 1000.0).abs() < 20.0, "{file} peak frequency {frequency}");
        assert_eq!(output.metadata.as_ref().unwrap().codec, codec);
    }
}
#[test]
fn corrupt_audio_is_a_clean_error() {
    if std::env::var_os("AUDIO_ANALYZER_RUN_CODEC_TESTS").is_none() { return; }
    let path = fixture("broken.mp3");
    std::fs::write(&path, b"not audio data").unwrap();
    let result = probe(&path);
    assert!(result.is_err());
    std::fs::remove_file(&path).unwrap();
}
