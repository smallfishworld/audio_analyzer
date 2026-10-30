# Audio Analyzer

**免费、开源、离线优先的音频分析桌面应用。** 采用 Tauri 2、React、Rust 与 FFmpeg。借鉴 Adobe Audition 的波形和频谱分析交互，**只读分析，不支持编辑、混音、音频效果器或录音**。

## 最新预览版（波形与时频谱修复）

最新预览版本 **v0.1.0-preview.2**（修复 60 秒纯音波形实心块、STFT 深蓝背景、时频图裁剪及错误谱峰）。下载安装包请查看 [GitHub Releases](https://github.com/smallfishworld/audio_analyzer/releases)。新版本的安装包只在 Windows/macOS 双架构 CI 全部成功后才发布。旧 alpha.1～alpha.5 已从 Releases 清理；原始 `v0.1.0-preview.1` 仅保留作为历史预览，新版本发布后请优先安装 `v0.1.0-preview.2`。

| 系统 | 安装包 | 注意 |
|---|---|---|
| Windows 10/11 x64 | NSIS EXE | 安装程序未签名 |
| macOS Apple Silicon (M 系列) | ARM64 DMG | ad-hoc 签名、未 Apple 公证 |
| macOS Intel | x86_64 DMG | ad-hoc 签名、未 Apple 公证 |

安装包内置 **FFmpeg 9.0.2 和 ffprobe**，并提供其 LGPL 对应源码、许可证与构建信息，离线使用无需另装 FFmpeg。

## 已实现的能力

- WAV、RAW PCM；PCM 支持 u8/s8/s16/s24/s32/f32/f64、大小端、交错/平面布局、采样率与数据偏移设置
- RAW PCM 格式启发式推测及人工修正；MP3/AAC/M4A/FLAC/AIFF/Ogg/Opus 等格式由内置 FFmpeg 解码（实际兼容性取决于编码变体）
- CH1～CHn 通道选择、时间轴、完整 RAW PCM/标准 WAV 的 Peak/RMS 和 min/max 波形概览
- 波形导航、时间选区、光标位置、频率与文件属性
- 可配置 1024/2048/4096/8192/16384 点 FFT，Hann/Hamming/Blackman/Rectangular 四种窗函数
- 选区 Peak/RMS 与谱峰检测、频率光标、STFT 时频谱和时域联动
- 只读试听，支持播放、暂停、停止、选区循环和预缓冲的 PCM 分块播放

## 预览版限制

- 高级选区分析单次最多处理 **2,097,152 帧**，超过限额需要分段选择。
- 压缩音频的默认概览/基础测量一般仍为前 3 秒；高级选区使用独立的局部解码。
- 全局概览最多约 1200 个 min/max 时间桶；近距离缩放可按需读取最多 65,536 帧真实 PCM 采样并显示周期。更大范围的多层 LOD 缓存尚未实现。
- STFT 是有限时间/频率分辨率的热力图；所有电平为 **dBFS**（数字满幅相对电平），非 **dB SPL**（声压级）或 PSD（功率谱密度）。
- 试听为当前选择声道的单声道输出，播放连续性及压缩格式定位精度仍需 Windows/macOS 真实声卡测试。
- 自动化测试与打包通过不代表真实桌面 GUI 和签名/公证验收全部完成。

## 从源码运行

需要 Node.js 22、Rust stable 及对应的 Tauri 2 平台依赖。

1. 安装依赖：npm install
2. 开发启动：npm run tauri dev
3. Rust 单测：cargo test --manifest-path crates/audio-core/Cargo.toml
4. Chromium 界面测试：npm run test:ui

## 文档与许可证

- [当前预览 Release Notes](docs/release-v0.1.0-preview.2.md)
- [产品需求](spec.md) / [技术选型](tech.md)
- [P1/P2 能力与验收](docs/p1-p2-verification.md)
- [FFmpeg 许可和打包](docs/bundled-ffmpeg.md)
- [UI 审查与后续问题](docs/ui-audition-review.md)

自有源码 MIT License；第三方依赖按各自许可证分发。过去 alpha.1～alpha.5 迭代记录仍可在 Git 仓库历史及 docs 中查看，不再作为单独的公开发布版本提供。
