# Audio Analyzer v0.2.0-alpha.5 — Audition 风格音频分析工作区

公开预览版。本次重点是 UI 布局、波形导航与分析工作流改进；只做分析，不做音频剪辑、效果器或混音。

## 新版 UI / 操作

- 采用三栏分析工作台：**左侧文件列表、中央波形编辑器（只读查看）、右侧频率分析 / 振幅统计 / 属性**。
- 全文件波形 Overview Navigator：缩略波形、可拖动视口框、主波形时间刻度与零线。
- 主要操作：鼠标滚轮以指针位置缩放；时间选区与 Selection In/Out/Duration；Zoom In / Out、Zoom to Selection、Fit All；Home/End、+/-、Esc、Ctrl/Cmd+O。
- 频谱独立展示 4096 点 Hann FFT（dBFS），可将 FFT 窗起始位置设为光标所在时间；采样率、声道和文件编码属性集中在右侧。
- 打开文件后可以从左侧本次会话列表重新打开；RAW PCM 保留用户已经确认的参数；修复旧 Demo 异步任务覆盖新文件结果的风险。
- 宽度较窄时分析侧栏可展开成覆盖式面板，避免按钮“点了没反应”。

## 验证

- React/TypeScript 前端编译、Rust DSP/PCM 测试、8 格式解码回归。
- 新增 Chromium 浏览器自动化 GUI 检查：面板几何顺序、实际 Canvas 波形像素、导航/选区/快捷键、文件打开/声道切换、窄窗口布局。测试工件中包含实际截图和失败 trace。
- Windows NSIS、macOS Apple Silicon ARM64 和 Intel x86_64 均需完成 CI 才自动发布，附 SHA256SUMS.txt。

## 范围与限制

- 不是 Adobe Audition 的完整功能复制，**没有编辑、录音、多轨、混音、效果器**。
- 当前无真实音频播放；不放无效的播放键。真实只读试听/播放头需后续开发。
- 波形仍是最多约 1200 桶的整文件 min/max 概览，缩放有分辨率限制；**还不能显示放大到样本级的精确 4kHz 周期**。未来开发多级 LOD 和按视口采样。
- FFT 仍是单个 4096 帧时间窗，STFT、选区分析、真实时频谱及高级统计尚未实现。
- 浏览器 GUI 测试使用模拟数据，不是 Windows WebView2/macOS WKWebView 的真机 GUI/音频实测。
- 压缩格式一般仍只分析开头 3 秒；RAW PCM/标准 WAV 已支持全文件 Peak/RMS 和概览波形。
- macOS DMG ad-hoc 签名、未 Apple 公证；Windows 安装程序未签名；仅作 Pre-release。
- 安装包继续内置 LGPL 版 FFmpeg 9.0.2/ffprobe 和对应源码许可证，离线可使用。

[UI 审查与未完成任务](https://github.com/smallfishworld/audio_analyzer/blob/main/docs/ui-audition-review.md) · [SPEC](https://github.com/smallfishworld/audio_analyzer/blob/main/spec.md)
