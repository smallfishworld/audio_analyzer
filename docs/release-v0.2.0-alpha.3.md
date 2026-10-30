# Audio Analyzer v0.2.0-alpha.3 — RAW PCM 智能导入预览版

## 本次新增：自动推测 PCM 格式并支持手动修改

打开 `.pcm`、`.raw` 或 `.bin` 时，应用会在后台读取最多 128 KiB 的数据并尝试推测：

- **格式与端序**：结合文件名的 `s16le`、`f32be`、`16bit` 等标记与原始音频统计特征，给出可能的整数/浮点 PCM 类型及 little/big endian 排序候选。
- **采样率和声道数**：只接受明确的文件名线索，例如 `sr32000`、`fs48000`、`stereo`、`2ch`。不把普通 `test_4kHz` 测试音的频率误判为采样率。
- **布局**：从 `planar`、`interleaved` 文件名线索推断。文件名没有标明时使用上次设置。
- **文件解析参数全部可修改**：采样率、声道数、采样格式、端序、偏移和声道布局均留在导入窗口由用户确认；支持 Re-detect 和切换备选解释。
- **不作虚假确定性宣称**：标记为文件名线索、统计估计或不确定；静音和不可判别输入保留上次设置，不自动宣布识别成功。

**RAW PCM 没有标准文件头，不能从字节流确定采样率、声道数和每个采样点的真实编码。自动识别只是一种辅助建议，实际采集配置优先。**

## 延续 v0.2.0-alpha.2 的完整 PCM/WAV 分析

RAW PCM 与可原生解析的标准 WAV 可分块扫描整文件，统计所选声道的全文件 Peak/RMS，并生成完整时长的 min/max 波形概览。FFT 仍是指定时刻的 4096 点 Hann 窗，不是整文件 FFT。

## 支持平台和安装

- Apple Silicon Mac（含 MacBook Air M5）：下载文件名含 `aarch64` 的 DMG。
- Intel Mac：下载含 `x86_64` 的 DMG。
- Windows 10/11 x64：下载 NSIS EXE。

安装包继续随附 LGPL-only FFmpeg 9.0.2 和 ffprobe，不要求另装 FFmpeg。

## 自动化验证

Rust 单元测试包含文件名解析、音频样本推断、无法判别的静音数据和测试音频频率歧义；继续运行完整 PCM 与八格式编码回归、React/TypeScript 及三平台安装包检查。仅在同一提交的 Windows/macOS ARM64/Intel 均通过 CI 后创建本版 Pre-release。

## 当前限制

- 统计估计可能不适用于高噪声/失真数据、静音、短文件和采样参数不明的 PCM，请核对采集设备配置。
- RAW/WAV 全文件分析之外，MP3/AAC/FLAC 等仍为最前 3 秒预览。
- 未实现 STFT 时频谱、完整编解码导出、全文件扫描进度/取消，以及 GUI 实机兼容性验收。
- macOS 尚未 Apple 公证，Windows 安装包未签名，本版为 Pre-release。

[识别原理与可靠性边界](https://github.com/smallfishworld/audio_analyzer/blob/main/docs/raw-pcm-detection.md)
