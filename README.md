# Audio Analyzer

免费开源、离线优先的专业音频文件分析仪，支持 **Windows x64 / macOS Apple Silicon 与 Intel**（macOS 目前为未公证的开发预览版），基于 Tauri 2、React、Rust、realfft、uPlot。

当前进度：**M1 多格式导入开发中**。已实现 Rust FFmpeg/ffprobe 解码适配器与元数据分析。正在通过 CI 从官方源码编译并随包集成 LGPL FFmpeg（是否成功须以 GitHub Actions 结果为准）；完整文件分析尚未实现。

## 已实现的 M0 代码
- React 专业分析工作台：深色仪表界面、波形、FFT 频谱、峰值/RMS 数值卡片。
- Rust 合成信号演示（1 kHz + 7 kHz）及精确 dBFS 计算。
- WAV 与裸 PCM 文件前三秒预览。裸 PCM 可输入采样率、声道、整数/浮点格式、大小端、偏移字节。
- 首声道读取、4096 点 Hann 窗 FFT、频谱峰值、最值波形聚合。
- Rust 单测：静音、-3.0103 dBFS 正弦 RMS、-6.0206 dBFS 单频 FFT。
- GitHub Actions 前端、Rust 内核及 Windows 桌面检查（以实际 CI 结果为准）。

**限制**：前三秒预览统计不是整个文件统计；裸 PCM 已支持 interleaved/planar，但目前仅分析第一声道。压缩格式由 FFmpeg 解码；带 sidecar 的新安装包目标是无需用户自行安装 FFmpeg（旧版预览包仍需自行安装）；STFT、可配置 FFT、码率导出属于后续阶段。

## 开发运行

需要 Node.js 22、Rust stable、Tauri 2 对应平台构建依赖（Windows：WebView2/Visual C++ Build Tools；macOS：Xcode Command Line Tools）。

~~~sh
npm install
npm run tauri dev
cargo test --manifest-path crates/audio-core/Cargo.toml
~~~

浏览器运行 npm run dev 只能查看页面布局，调用 Rust 分析命令需要桌面 Tauri 环境。

## 文档

- [产品需求](spec.md)
- [技术方案](tech.md)
- [M0 验收记录](docs/m0-validation.md)
- [macOS ARM64 / Intel 构建及验收](docs/macos-validation.md)

不提供专用多 MIC 一致性及自动良率判定功能。

## Windows M0 安装包

GitHub Actions 的 M0 validation 工作流包含 Windows NSIS 构建和上传步骤；**请仅在该工作流完成且成功后下载 audio-analyzer-m0-windows artifact**。安装包未签名，且不含 FFmpeg 解码能力，仅提供 WAV/裸 PCM 演示与基础分析。


## M1 多格式解码（进行中）

目前 Rust 解码适配器可对 WAV、AIFF、FLAC、MP3、AAC ADTS、M4A、OGG Vorbis、Opus、ALAC 等非 DRM 格式进行 ffprobe 探测与 FFmpeg 浮点样本解码（具体格式依赖安装的 FFmpeg 构建，按 CI 验证矩阵确认）。对来源较长的文件只分析首 3 秒 / 最多 576000 采样帧，报告真实文件编码、采样率、码率（可获得时）、声道数和时长，并明确标识 preview。

在开发机安装 FFmpeg/ffprobe 并加入 PATH，运行应用后即可打开上述文件。无法找到时显示具体错误；Windows 安装包尚未内置经过法律审核的 sidecar。

M1 格式回归测试：

~~~sh
node scripts/generate-m1-fixtures.mjs
AUDIO_ANALYZER_RUN_CODEC_TESTS=1 cargo test --manifest-path crates/audio-core/Cargo.toml --test multiformat
~~~

项目不会自动联网下载 FFmpeg，正式独立分发需先通过许可证审核与 Windows 打包测试。详见 [M1 验证记录](docs/m1-validation.md)。

## M1 Preview 版本说明

版本：0.2.0-alpha.1。CI 安装包 Artifact 名为 audio-analyzer-m1-preview-windows。此前的 v0.2.0-alpha.1 预览包不附带 FFmpeg；新的 self-contained 构建将内置 FFmpeg/ffprobe 和匹配源码/许可材料。是否已完成须以对应 CI 的构建产物为准。安装包未签名，不是正式发布。

## M0/M1 Review 修复分支

本次补充的能力：对 WAV、RAW PCM（interleaved/planar）及 FFmpeg 格式选择 CH1…CHn、超时与受限 FFmpeg 解码、避免旧异步结果覆盖当前界面；增加第二声道/超时测试。请以新 PR 的 CI 结果判断能否正式使用。

[完整审查与剩余任务](docs/code-review-m0-m1.md)。

注意：**只能查看所选通道最前面 3 秒/最多 576000 帧的预览**，尚非全文件分析；这与多 MIC 一致性自动判定无关。旧 M1 Windows 安装包尚未内置 FFmpeg；新的 self-contained 构建正在验证。

## macOS 开发版（Apple Silicon / Intel）

macOS 两套原生构建分别采用 GitHub `macos-15` 与 `macos-15-intel` runner，并生成 `.app` + `.dmg`。构建入口：[macOS Actions](https://github.com/smallfishworld/audio_analyzer/actions/workflows/macos.yml)。CI 通过后，下载与芯片对应的 Artifact：`audio-analyzer-m1-macos-apple-silicon-arm64` 或 `audio-analyzer-m1-macos-intel-x64`。

本机 macOS 构建：

```bash
npm install
npm run prepare:icons
bash scripts/generate-macos-icons.sh
npm run tauri build -- --bundles app,dmg
```

**重要**：当前 DMG 为 ad-hoc 签名但**没有 Apple 公证**，Gatekeeper 可能拒绝普通双击，正式发行前需要 Developer ID 签名与 Notarization；CI 成功不等于已在用户 Mac 上验收。WAV/裸 PCM 不依赖 FFmpeg，其余压缩格式仍需开发机自己安装 FFmpeg，例如 `brew install ffmpeg`。Finder 启动时自动尝试 /opt/homebrew/bin、/usr/local/bin。音频仅首三秒预览，完整 M1 尚未验收。

## FFmpeg 离线集成（self-contained）

新的打包流程使用 FFmpeg **9.0.2** 官方源码，SHA-256 校验后编译不启用 GPL/nonfree 的版本，把 `ffmpeg`、`ffprobe` 及对应源码/许可证一起装入 NSIS 和两个 macOS DMG。release 模式优先且仅使用安装包内的解码器，不依赖用户的 Homebrew / PATH。

- [许可证、构建复现与验收要求](docs/bundled-ffmpeg.md)
- [macOS CI 双架构工作流](.github/workflows/macos.yml)
- [Windows CI 工作流](.github/workflows/ci.yml)

CI 安装包 Artifact 以 `audio-analyzer-m1-self-contained-*` 命名；只有对应工作流全部成功并检验包内 sidecar 后才算可用。正式 macOS 对外分发还需要 Apple Developer ID 公证，完整多格式音频功能与全文件分析还在 M1 后续开发中。
