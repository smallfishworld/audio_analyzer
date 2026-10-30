# Audio Analyzer

**免费、开源、离线优先的专业音频分析与可视化工作站**。支持 **Windows x64、macOS Apple Silicon、macOS Intel**，使用 Tauri 2 + React + Rust + FFmpeg。借鉴 Adobe Audition 的波形浏览、选区与频谱分析交互，但**仅做分析，不做音频剪辑、混音或效果处理**。

> **v0.2.0-alpha.3 — 完整 PCM/WAV + 智能导入预览版。** 目前是早期版本，不是完整专业测量套件；具体下载与限制见 [Release 说明](docs/release-v0.2.0-alpha.3.md)。

## 下载

从 [GitHub Releases](https://github.com/smallfishworld/audio_analyzer/releases) 下载：

| 设备 | 安装文件 | 注意 |
|---|---|---|
| MacBook Air/Pro，Apple Silicon M 系列 | `aarch64` / `arm64` 的 DMG | 未公证的预览版 |
| Intel Mac | `x64` / `x86_64` 的 DMG | 未公证的预览版 |
| Windows 10/11 x64 | NSIS `.exe` | 未签名的预览版 |

发布版内置 **FFmpeg 9.0.2 + ffprobe**（独立 sidecar），**无需额外安装 FFmpeg/Homebrew**；匹配源码、LGPL 授权文件、构建配置及校验值与程序一起分发。详细说明见 [FFmpeg 集成与许可](docs/bundled-ffmpeg.md)。

## 已实现的分析能力

- 直接导入 WAV 和无头 PCM；PCM 可以设置采样率、声道、u8/s8/s16/s24/s32/f32/f64、大小端、数据偏移与 interleaved/planar 布局。
- 内置 FFmpeg 对 MP3、FLAC、AAC/M4A、AIFF、Ogg Vorbis、Opus 等文件进行探测与解码（具体 codec 支持由内置构建和兼容矩阵确定）。
- 通道切换（CH1～CHn），源文件只读属性：编码、采样率、声道数、码率（如能取得）、时长。
- 显示波形、4096 点 Hann FFT 幅度谱、峰值 dBFS、RMS dBFS、主频和 Nyquist 频率。
- 解码超时保护、有限解码输出、基本错误提示；音频分析由 Rust 后台工作线程执行。

## 重要限制

- **RAW PCM 与标准 WAV 支持全文件 Peak/RMS 和波形概览**；压缩音频（MP3/AAC/FLAC/Opus 等）仍只分析所选声道最前面的 3 秒 / 最多 576000 帧。PCM FFT 可以选择起始时间，但只计算该位置的 4096 帧，不是全文件 FFT。
- FFT 点数和窗函数尚不可调整，频谱只是幅度谱而非 PSD；时频谱、导出编码参数及选区分析仍未实现。
- 当前没有专业 dB SPL（声压级）校准，不做专用多 MIC 一致性测试。
- macOS DMG 使用 ad-hoc 签名，**未 Apple 公证**；Windows 安装程序未签名；实际用户设备的 GUI 与离线安装还需进一步验收。
- 自动化验证和 GitHub 构建不等同于完整真实设备验收。

## 参与开发

需要 Node.js 22、Rust stable 和对应平台的 Tauri 2 构建依赖。

```bash
npm install
npm run tauri dev
cargo test --manifest-path crates/audio-core/Cargo.toml
```

开发模式可以使用系统安装的 FFmpeg；正式 release 构建使用自己打包的审核版，不静默退回系统 FFmpeg。Windows 构建脚本与 macOS 双架构工作流会从官方固定 SHA256 源码构建 sidecar。

## 文档

- [产品需求 spec.md](spec.md)
- [技术方案 tech.md](tech.md)
- [FFmpeg 随包与许可证](docs/bundled-ffmpeg.md)
- [M0/M1 Review 与待办](docs/code-review-m0-m1.md)
- [M1 验证记录](docs/m1-validation.md)
- [macOS 兼容与打包验证](docs/macos-validation.md)
- [首版 Release Notes](docs/release-v0.2.0-alpha.1.md)
- [剩余工程任务](https://github.com/smallfishworld/audio_analyzer/issues/4)

## 授权

Audio Analyzer 自有源码基于 [MIT License](LICENSE) 发布。FFmpeg 和其余第三方依赖遵守各自的许可证；FFmpeg 是 LGPL-only 单独可执行程序，并随包提供对应源代码、许可文本和构建记录。具体部署还需遵守适用地区的编解码专利及软件签名要求。

## 完整 PCM/WAV 分块分析（开发中）

v0.2.0-alpha.3 已将 RAW PCM 与 PCM WAV 从 3 秒预览升级为**全文件 Peak/RMS 与完整时域波形概览**，并支持指定起始时间的 4096 点 FFT。压缩格式仍为前三秒预览；旧版 v0.2.0-alpha.1 仍保持旧限制。技术实现、计算语义及性能限制参见 [完整 PCM 分析文档](docs/full-file-pcm.md)。

## 裸 PCM 智能导入（开发版）

打开无头 `.pcm`、`.raw`、`.bin` 时自动尝试分析文件名与少量原始样本，给出格式/端序候选和推断说明，**所有参数仍可手动修改**。RAW PCM 不含标准采样率和声道头信息，不能保证自动识别准确。详细见 [RAW PCM 智能推断文档](docs/raw-pcm-detection.md)。该功能从 v0.2.0-alpha.3 开始提供，原有全部字段均可手动修改。

## 波形显示优化（A0 开发中）

用户反馈波形无法正常显示。审查发现原波形将每个时间桶的 min/max 分别绘制为折线，正弦波在全文件概览下可能呈现上下两条“直线”；同时存在 uPlot 样式缺失的风险。本次修复新增独立 Canvas2D min/max 峰值包络视图、完整时间标尺、指针选区、以鼠标为中心滚轮缩放、Zoom to Selection 与 Fit Entire File，并将波形作为全宽主视图。**只有提交完成并通过平台构建后，新安装包才会提供这项修复。**

参见 [SPEC 2.0](spec.md)；产品明确仅做音频分析，试听也只用于定位分析，不会修改原文件。下一阶段需要多级 LOD 局部波形及 Windows/macOS 真实 GUI 验收，不会把放大 1200 个包络桶冒充样本级波形。
