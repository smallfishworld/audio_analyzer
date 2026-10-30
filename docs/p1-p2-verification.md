# P1/P2 implementation and verification (2026-10-30)

Branch: \`feat/p1-p2-spectrum-playback-spectrogram\`; PR #12.

## Delivered (analysis-only)

- P1 frequency analysis: configurable FFT size (1,024 / 2,048 / 4,096 / 8,192 / 16,384), Hann / Hamming / Blackman / rectangular windows, magnitude averaging across the selected interval, peak interpolation and top-five spectral peaks, frequency cursor, selection Peak/RMS. All level values are **dBFS**, not dB SPL or PSD.
- P2: STFT-derived time-frequency heatmap (maximum 220 time columns × 256 frequency buckets); clicking the time axis moves the waveform cursor. STFT resolution follows selected FFT size. Spectrogram color is a display-only scale from approximately −110 to 0 dBFS.
- Read-only audition: Play / Pause / Stop, start from cursor, loop selection, separate playback head over waveform. Web Audio output receives bounded original-rate samples from Rust; it never acts as the source for numeric measurements and never edits the source.
- Source support: native WAV and RAW PCM (with confirmed format / channel layout); FFmpeg media decoding through the packaged sidecar. No implicit channel mixing or resampling.
- Audio chunks are requested at no more than 1.5 seconds each. The player schedules an approximately 2.5-second decoded look-ahead to reduce gaps between chunks.

## Explicit limits

- The professional analysis command processes **at most 2,097,152 selected-channel frames per request**, not the complete file for an arbitrarily long selection. A longer range reports an error rather than silently truncating it.
- A selected interval must contain at least \`fftSize\` sample frames; peak frequency is estimated from FFT bins and should not be interpreted as metrology-grade accuracy without calibration.
- The STFT heatmap uses a bounded/reduced frequency display resolution; values are dBFS magnitudes, not power spectral density and not sound pressure.
- For compressed files, accurate seeking depends on the codec/container and FFmpeg. Separate testing with real lossy clips is needed to validate exact trim/seek timing.
- The playback output is a **mono audition of the explicitly selected channel**; stereo monitoring/mixing is not part of this milestone. Short playback gaps remain possible if decoding takes longer than buffered look-ahead.
- **Sample-level waveform LOD is not included here**; overview zoom remains limited by its original buckets.
- Desktop CI and Playwright browser tests do not substitute for a physical macOS / Windows audio device, WebView2 / WKWebView, signing or notarization acceptance.
- This version is a development PR; existing v0.2.0-alpha.5 installers do **not** contain these changes.

## Suggested acceptance on a real device

1. Import a known 32 kHz, 60-second 4 kHz sine WAV and RAW PCM; check sample rate, start, peak dBFS (~0) and RMS dBFS (~−3.01).
2. Compare 1024/4096/16384 FFT against known 4 kHz / 16 kHz-limit signals; set Hann/Blackman windows.
3. Drag a distinct time selection, analyze it, check peak and RMS are from that range and check spectrogram heatmap time-click cursor.
4. Play, pause and stop at arbitrary times; loop an audible selection, including a segment boundary; verify no file modification.
5. Repeat for an AAC, MP3 and stereo WAV; use CH2 and ensure playback/measurement uses only that channel.
6. Select a range beyond the analysis budget: a clear error must appear without reporting partial measurements as full-range values.

## Tests

- \`cargo test --manifest-path crates/audio-core/Cargo.toml\` tests selection peak, FFT windows, STFT columns, PCM chunk slicing and bounded short selections.
- \`cargo test --manifest-path crates/audio-core/Cargo.toml --test multiformat\` covers existing codec decoding regression.
- \`npm run build\` checks React/TypeScript production build.
- \`npm run test:ui\` checks FFT selector, peak inspector, STFT cursor and Play/Pause/Stop using Chromium and mocked Tauri IPC.
