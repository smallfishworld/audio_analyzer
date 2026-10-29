# Audio Analyzer

免费开源、离线优先的专业音频文件分析仪。基于 Tauri 2、React、Rust、realfft、uPlot。

当前进度：**M1 多格式导入开发中**。已实现 Rust FFmpeg/ffprobe 解码适配器和元数据分析，支持系统安装了 ffmpeg 与 ffprobe 的开发环境。**Windows 安装包仍不内置 FFmpeg**，因此不能声称压缩格式已做到开箱即用。

## 已实现的 M0 代码
- React 专业分析工作台：深色仪表界面、波形、FFT 频谱、峰值/RMS 数值卡片。
- Rust 合成信号演示（1 kHz + 7 kHz）及精确 dBFS 计算。
- WAV 与裸 PCM 文件前三秒预览。裸 PCM 可输入采样率、声道、整数/浮点格式、大小端、偏移字节。
- 首声道读取、4096 点 Hann 窗 FFT、频谱峰值、最值波形聚合。
- Rust 单测：静音、-3.0103 dBFS 正弦 RMS、-6.0206 dBFS 单频 FFT。
- GitHub Actions 前端、Rust 内核及 Windows 桌面检查（以实际 CI 结果为准）。

**限制**：前三秒预览统计不是整个文件统计；裸 PCM 已支持 interleaved/planar，但目前仅分析第一声道。压缩格式使用 FFmpeg 解码，只有 ffmpeg 和 ffprobe 可被应用进程找到时才生效；STFT、可配置 FFT、码率导出属于后续阶段。

## 开发运行

需 Node.js 22、Rust stable、Tauri 2 Windows 前置依赖（WebView2/Visual C++ Build Tools）。

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
