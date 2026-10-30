# Audio Analyzer v0.2.0-alpha.2 — 完整 PCM / WAV 分析

这是继 v0.2.0-alpha.1 之后的公开预览版本，主要解决 PCM 文件只能分析前三秒的问题。

## 本版新增

- **RAW PCM 全文件分析**：分块读取选中声道的全部采样帧，计算全文件 Sample Peak、RMS dBFS。
- **标准 WAV 全文件分析**：同样扫描所有 PCM 帧，不再限制前三秒。
- **完整波形概览**：按整个文件时间跨度生成最多约 1200 个 min/max 包络桶，而不是一次性把全部采样点送进界面。
- **FFT 时间定位**：输入 FFT 起点（秒），对该位置连续 4096 帧执行 Hann 窗 FFT，支持跳过前三秒检查后面的频段。
- **多声道**：RAW PCM interleaved/planar 与 WAV 均支持选择声道。用户无需提供额外的 FFmpeg。
- **精度回归**：新增第 3 秒以后的 PCM 信号、planar 双声道尾部、WAV 全时长、8 MiB 稀疏文件全量扫描测试；Rust 测试 16 项全部通过。

## 系统安装包

- macOS Apple Silicon（M1～M 系列，包括 M5）：选择带 aarch64 的 DMG。
- macOS Intel：选择 x86_64 的 DMG。
- Windows 10/11 x64：选择 x64 NSIS 安装程序。
- 继续内置 LGPL 构建的 FFmpeg + ffprobe，无需用户单独安装，匹配源码和许可证随安装包提供。

## 明确的限制

- **全文件统计只适用于 RAW PCM 和可由 native WAV 解析器直接读取的标准 WAV**。MP3、AAC、FLAC、Opus、OGG 等其他格式仍为前三秒预览。
- FFT 只计算指定位置的 **4096 帧窗口**，不表示整份文件的平均频谱，也不包括 STFT 时频谱或 Welch PSD。
- 全文件扫描需要依次读取数据，耗时随文件大小增加；更改 FFT 时间目前会重复扫描全文件，尚未加入快速索引缓存、扫描进度条或取消。
- 波形显示为全文件缩略概览，而非高倍率缩放后重新读取的完整原始样本。
- 尚未完成 1 GiB 真实文件基准测试、Windows/macOS 真机 GUI 交互验收。
- Windows 未签名，macOS DMG 为 ad-hoc 签名且未经 Apple 公证；仍标记为 Pre-release。

## 质量门禁

同一提交的 Rust 单元测试、8 格式集成解码、前端构建、Windows NSIS 和 macOS ARM64/Intel DMG 必须全部通过后才会发布；附件包含 SHA256SUMS.txt。

更多实现与边界见 [完整 PCM 分块分析](https://github.com/smallfishworld/audio_analyzer/blob/main/docs/full-file-pcm.md)。历史 v0.2.0-alpha.1 不受影响。
