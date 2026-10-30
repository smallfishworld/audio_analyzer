# Audio Analyzer v0.1.0-preview.1 — First Public Preview

Audio Analyzer 的第一版统一公开预览版。免费、离线优先、只读音频分析。同步提供 Windows x64、macOS Apple Silicon 和 macOS Intel 安装包；**这是 Preview，不是稳定版**。

## 首版提供

- WAV / RAW PCM 多采样格式导入，多声道选择；自动推荐 RAW PCM 解释参数，可手动修改
- 内置 FFmpeg 9.0.2 / ffprobe 支持常见 MP3、AAC/M4A、FLAC、AIFF、Ogg/Opus 等媒体解析与解码
- RAW PCM / 标准 WAV 全文件 Peak/RMS、完整时域概览、光标、滚轮缩放、选区导航
- 1024～16384 点可配置 FFT、Hann/Hamming/Blackman/Rectangular 窗、时间选区统计、前五个频谱峰值及频率光标
- STFT 时频谱视图和时间定位；按所选声道只读试听、播放/暂停/停止与选区循环
- 安装包内置 FFmpeg 及其 LGPL 源码、构建信息和许可证；SHA256SUMS.txt 附校验值

## 当前限制

- 高级选区分析一次最多 2,097,152 帧；压缩格式默认概览仍主要覆盖前三秒
- 波形概览约 1200 桶，未实现样本级 LOD 放大；STFT 热力图为有限分辨率，非 PSD
- 指标为数字 dBFS，非经校准的声压 dB SPL；只读播放当前选择的单声道
- 压缩编码随机定位精度、真实声卡连续播放、macOS/Windows 原生 GUI 仍需实机验收
- Windows 安装包未签名；macOS 为 ad-hoc 签名，尚未 Apple 公证
- 本软件不提供剪辑、混音、录音或修改源文件的操作

## 发布质量门禁

三个新安装包由同一源码提交构建；Rust、前端、解码回归、浏览器 UI、Windows NSIS 和两种 macOS DMG 全部成功，且安装包及校验文件齐全后，工作流先删除所有以前的 GitHub Releases 与对应标签，再创建这一版。

[项目主页](../README.md) · [P1/P2 验收](p1-p2-verification.md) · [FFmpeg 许可证](bundled-ffmpeg.md)
