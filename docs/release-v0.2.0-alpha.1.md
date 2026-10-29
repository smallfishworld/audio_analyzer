# Audio Analyzer v0.2.0-alpha.1 — 首个公开预览版

这是 Audio Analyzer 首次 GitHub Release（**Pre-release / 开发预览版，不是稳定版**）。它面向嵌入式音频、文件频谱与数字电平分析，支持 Windows 和 macOS。

## 下载与平台

- **macOS Apple Silicon（M1/M2/M3/M4/M5 等）**：下载文件名含 `aarch64` 的 DMG。
- **macOS Intel**：下载文件名含 `x64` 或 `x86_64` 的 DMG。
- **Windows 10/11 x64**：下载 `.exe` 安装程序。

Windows 与 macOS 的构建均从官方源码生成 FFmpeg 9.0.2 的 LGPL-only sidecar（`ffmpeg`、`ffprobe`）并打进安装包，**普通用户无需另装 FFmpeg 或 Homebrew**。对应源码及许可资料随包分发。

## 已提供功能

- 基于 Tauri 2 + React + Rust 的深色专业音频分析工作台。
- WAV 与 RAW PCM（u8/s8/s16/s24/s32/f32/f64，大小端，interleaved 或 planar）的采样率、声道、偏移参数化导入。
- MP3、AAC/M4A、FLAC、AIFF、Ogg Vorbis、Opus 等文件的 FFmpeg 解码预览及只读元数据。
- 可在 1～16 个声道中选择要分析的声道（格式允许时）。
- 4096 点 Hann 窗 FFT、单边幅度谱 dBFS、Sample Peak/RMS、主频、采样率与 Nyquist 显示。
- 解码进程超时和有界输出，坏音频返回明确错误。
- GitHub CI 的 Rust 单元测试、八种格式集成测试、Windows / macOS 双架构安装包与 FFmpeg 随包验证。

## 当前限制（请在下载前阅读）

- **只分析当前选中声道的前 3 秒 / 最多 576,000 帧**，不是整文件统计，不支持对任意区间进行测量。长文件只显示预览。
- FFT 窗与点数暂时固定；完整时频谱、PSD、高级数值分析、导出采样率/码率设置尚未开发。
- 这不是校准的声压级仪器；dBFS 不等同于 dB SPL。
- macOS DMG 为 ad-hoc 签名，**未做 Apple Developer ID 公证**，Gatekeeper 可能显示安全提示；尚未完成普通用户 Mac 真机 UI 验收。
- Windows EXE 未代码签名，SmartScreen 可能提示未知发布者；尚未完成多台真实 Windows 设备的安装验收。
- 不实现专用多 MIC 一致性或自动合格判定。

## 自测与验证

发布流水线仅在同一 commit 的 **Windows CI 全部成功** 且 **macOS ARM64 / Intel CI 全部成功** 时才创建 Release。校验项目包括：

- Rust 数学/PCM 单测、FFmpeg 八种格式的 decode_preview 回归与前端编译；
- 从锁定 SHA256 的 FFmpeg 官方源代码编译 LGPL-only 二进制；
- 验证随包 FFmpeg 的 WAV、FLAC、AAC 编解码，检查许可证配置；
- 校验 Windows NSIS 内包含 sidecar、匹配源码及许可文本；
- 校验 macOS `.app` 的 sidecar、架构、ad-hoc 代码签名和 DMG 完整性；
- 发布附件附带 SHA256SUMS.txt 校验值。

上述自动化构建和内核测试 **不能替代完整 GUI 真机测试**；问题可通过 GitHub Issues 反馈。

项目源码授权为 MIT；FFmpeg 和第三方组件遵守各自许可证（FFmpeg 源码及 LGPL 材料随安装包提供）。

[产品需求](https://github.com/smallfishworld/audio_analyzer/blob/main/spec.md) · [技术架构](https://github.com/smallfishworld/audio_analyzer/blob/main/tech.md) · [FFmpeg 许可与复现](https://github.com/smallfishworld/audio_analyzer/blob/main/docs/bundled-ffmpeg.md)
