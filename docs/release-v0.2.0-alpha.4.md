# Audio Analyzer v0.2.0-alpha.4 — 波形显示修复 / 分析专用

这个公开预览版重点解决用户反馈的**波形显示不正确、无法快速查看整段音频**问题；不引入音频编辑功能。

## 主要改进

- 全宽波形主视图排在统计卡片上方，打开文件后更易找到。
- 新的 Canvas2D 波形层正确绘制每个时间桶的 min/max 包络，而不是把 min/max 两组数值连接成近似水平的折线。
- 时间刻度、0 幅度基线、指针拖动选择时间范围、滚轮定位缩放、Zoom to Selection 和 Fit Entire File。
- 按高 DPI 和窗口变化更新画布，提供无波形数据时的占位提示。
- 修复原 FFT 图表遗漏 uPlot 官方 CSS 的风险。
- 更新 SPEC 2.0：对标 Adobe Audition 的波形浏览、频率分析、振幅统计交互，**只做音频分析，不做剪切、混音、多轨或音效处理**。

## 保留的已有功能

- RAW PCM 与标准 WAV：完整文件 RMS/Peak 扫描和时间跨度内的波形概览，可选择 FFT 窗起始时间。
- RAW PCM 智能格式推测、支持手动修改采样率/位深/大小端/声道等参数。
- FFmpeg 9.0.2 + ffprobe LGPL-only 随包，用于 FLAC/MP3/AAC/Opus 等输入解码，压缩格式仍可能只提供前三秒预览。
- Windows x64 和 macOS ARM64/Intel 三平台原生安装包。

## 重要限制与验证

- **当前波形是全时段的低分辨率包络概览**，不能通过反复放大固定 1200 个桶获取真实单样本细节。下一阶段将实现多级 LOD 和按视口从 Rust 重新读取样本。
- 当前 FFT 仍固定 4096 点 Hann 窗；STFT、选区 RMS/FFT、频率分析高级功能、只读播放尚未完成。
- CI 会检查前端 TypeScript、Rust DSP/PCM 单元测试、八格式编解码测试、Windows NSIS、macOS ARM64/Intel DMG。**CI 构建成功不等于 Windows/macOS 真机 GUI 截图和交互验收已完成**。
- macOS DMG 未完成 Developer ID 公证，Windows EXE 未签名；仅作为 Pre-release。
- 程序不会编辑或覆盖原始音频。

详见 [SPEC 2.0](https://github.com/smallfishworld/audio_analyzer/blob/main/spec.md) 和 [技术方案](https://github.com/smallfishworld/audio_analyzer/blob/main/tech.md)。
