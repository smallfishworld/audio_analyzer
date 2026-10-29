# Audio Analyzer

免费开源、离线优先的专业音频文件分析仪。基于 Tauri 2、React、Rust、realfft、uPlot。

当前进度：**M0 工程原型**。CI 尝试构建未签名 Windows NSIS 安装包；仅在构建工作流成功且产物存在时视为可下载原型。FFmpeg sidecar 尚未合规分发。

## 已实现的 M0 代码
- React 专业分析工作台：深色仪表界面、波形、FFT 频谱、峰值/RMS 数值卡片。
- Rust 合成信号演示（1 kHz + 7 kHz）及精确 dBFS 计算。
- WAV 与裸 PCM 文件前三秒预览。裸 PCM 可输入采样率、声道、整数/浮点格式、大小端、偏移字节。
- 首声道读取、4096 点 Hann 窗 FFT、频谱峰值、最值波形聚合。
- Rust 单测：静音、-3.0103 dBFS 正弦 RMS、-6.0206 dBFS 单频 FFT。
- GitHub Actions 前端、Rust 内核及 Windows 桌面检查（以实际 CI 结果为准）。

**限制**：前三秒预览统计不是整个文件的统计；当前仅导入交错排列裸 PCM。FFmpeg 在 M0 仅作系统可执行文件探测，MP3/AAC/FLAC/Opus 的真实解码属于 M1；STFT、可配置 FFT 与码率导出属于 M2–M3。

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
