# M0 技术验证与验收

日期：2026-10-29

## 已提交实现
- Tauri 2 / React / TypeScript / Rust 工程结构及深色工作台，波形和 FFT 频谱使用 uPlot。
- 文件读取/FFT 分析通过 Rust 后台任务执行，避免同步阻塞界面。
- 原始 PCM 和 WAV 前三秒首声道读取、归一化，dBFS 与 FFT/波形图。
- M0 合成演示信号与三项 Rust 数值回归测试。
- ffprobe 诊断（仅识别本机程序，未打包、未解码）；GitHub Actions 工作流。
- FFmpeg 交叉编码实验：工作流测试 WAV→FLAC/MP3/AAC/Opus，ffprobe 识别及解码为浮点 PCM；这是测试机的 FFmpeg，尚非随包 sidecar。
- 可复现生成的应用图标及 Windows NSIS 安装包构建工作流。

## 验收证据

- 源码提交：已完成。
- npm 前端 TypeScript/Vite 编译：**通过**（CI #4，https://github.com/smallfishworld/audio_analyzer/actions/runs/40880435084）。
- Rust 核心测试：**通过**（CI #4）。
- Tauri Windows cargo check：**通过**（CI #4）。
- FFmpeg 编解码可行性：**通过测试机实验**（CI #4，非实际应用集成）。
- FFmpeg 多格式解码及 sidecar 打包：**未实现，待 M1**。
- WebGL2 时频谱技术验证、IPC 大规模传输和 1GB 压测：**未执行**。
- Windows NSIS 安装包：已启用 bundle.active 并配置工作流上传未签名 M0 原型（CI #5，https://github.com/smallfishworld/audio_analyzer/actions/runs/40880828477）；**正式安装包可用性以构建产物和实机验证为准**。
- Windows 离线安装/Windows SmartScreen 与真实机器 UI：**尚未验收**。
- 锁文件：待在具备网络与 Rust 工具链的环境生成并提交。

## 数值与范围说明

- 峰值与 RMS dBFS 基于归一化第一声道预览数据。
- FFT 使用 4096 点 Hann 窗，相干增益修正，输出单音幅度谱 dBFS，并非 PSD。
- 静音返回 null 表示负无穷 dBFS，JSON 不直接传递 Infinity。
- 用户输入的 PCM 采样率用于解释样本时间轴，不执行重采样。
- M0 必须通过 CI、侧载程序验证以及 FFmpeg 许可可行性验证后，才能宣布完全达标。

## 后续阻塞
1. CI #4 已通过前端、Rust 内核、Windows 编译及 FFmpeg 实验；验证 CI #5 Windows NSIS 安装包真实产物，并在 Windows 真机打开和分析文件；补齐 npm/Cargo 锁文件。
2. 审核并集成 ffmpeg/ffprobe 合规 sidecar，形成无外部依赖的离线应用包。
3. Windows 真机 UI、性能和 1 GB 文件分析压测；验证 WebGL2 降级路径。
4. 在许可证路径确认前不分发未经审计的 FFmpeg 二进制；不能把 M0 demo 与 M1 完整多格式支持混淆。
