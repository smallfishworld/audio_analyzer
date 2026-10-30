# Waveform and STFT rendering review — 32 kHz / 4 kHz / 60 s PCM

**Reported symptom:** screenshot of `test_4kHz_0dB.pcm` shows an opaque turquoise time-waveform rectangle and a blue STFT rectangle. Spectrum identifies the correct 4.000 kHz tone; sample peak 0 dBFS and sine RMS about -3.01 dBFS match expectations.

## Root causes (not a decoder failure)

1. The full-file PCM accumulator stores only ~1,200 min/max envelope buckets. Each bucket of this signal spans **50 milliseconds, or 200 full 4 kHz cycles**; so min/max always reaches ~±1. A rectangle is mathematically the correct dense envelope, **not an actual waveform trace**. The old Canvas repeated each bucket across its full width and filled the entire min/max column, making the plot an opaque panel.
2. The old zoom was clamped to `duration/12`: for a 60-second file, users could never zoom below 5 seconds, so no 4 kHz cycle was resolvable.
3. STFT canvas used `blue=170*(1-t)`, so a floor below -110 dBFS was painted as a bright blue panel rather than quiet background. A single 4 kHz FFT ridge is only about one display row high, effectively hidden.
4. STFT FFT bins mapped to one of 256 display rows by truncating the index; a 4 kHz bin at a 32 kHz rate mapped to row 63 rather than the nearest row 64.
5. The spectrum graph used an area fill, and peak detection listed extremely low floating-point/quantization sidelobes alongside the genuine main peak.
6. The audio preview IPC clamps values to ±1, which would be incorrect for a scientific waveform of floating-point PCM with over-full-scale values. Plotting must not reuse the audition interface.

## Architecture after patch

- **Full overview**: existing bounded 1,200-bucket min/max over all frames; use a subdued envelope visualization and a visible explanation about dense signals.
- **Sample viewport**: on demand from a new read-only `waveform_samples` Tauri command. Request only up to 65,536 selected-channel frames, seek to the actual sample boundary, and use **unclipped f64 source samples**. No entire-file reads are sent to the WebView.
- **Fine zoom**: when there are at most roughly three sample points per pixel, draw a true sample polyline and individual markers at high magnification. At intermediate zoom, aggregate exact fetched samples into per-pixel min/max columns.
- **Continuous zoom**: minimum 8 original frames (no `duration/12` restriction). The `Samples` control jumps near the cursor to a ~16 ms window. For steady full-scale tones only, this window is automatically opened on file load; the 60-second navigator remains fully visible.
- **STFT**: calibrated dark-to-yellow -120 to +6 dBFS palette, explicit legend and time/frequency/dBFS cursor. Nearest-row backend frequency mapping and a one-row **rendering-only** glow for narrow pure tones.
- **Spectrum**: no misleading background area fill; prominent strongest-frequency readout; suppress peaks below -90 dBFS or over 60 dB down from the strongest tone.
- **Read-only**: waveform IPC is independent of audio output and never alters the file.

## Regression coverage

- Rust: generate a **real** 60-second s16 PCM file with 32 kHz sample rate and 4 kHz 0 dBFS sine. Verify 1.92 million source frames, full overview 1,200 buckets, individual raw samples after a 17 ms seek, 4 kHz strongest FFT peak, ~-3.01 dBFS RMS and 4 kHz STFT row.
- Rust: f32 values `1.5` and `-1.25` remain intact in waveform rendering while audio audition still clamps to ±1 for playback.
- Playwright: 60-second dense waveform auto-zooms while full overview remains intact; sample trace has visible pixels rather than a filled panel; Fit and Samples still work.
- Playwright: clean 4 kHz STFT has at least 90% dark background with a visible bright ridge.
- Existing: browser workspace, source import, channel switching, selection, controls, Rust full-file PCM/WAV, codecs.

## Remaining boundaries

A 60-second 4 kHz file has **240,000 cycles**: no 900-pixel view can display each of them at full file scale. At full fit, a min/max envelope is inherently dense. The purpose of a two-resolution navigator/sample design is to avoid misrepresenting the signal and allow inspection of individual periods. Dynamic multiple level-of-detail cache layers and persistent 2+ second zoom remains future work.

Source tests and browser mock tests are not a substitute for an actual Windows/macOS microphone/audio device and WebView pixel rendering acceptance. **The existing published `v0.1.0-preview.1` installers predate this patch.**
