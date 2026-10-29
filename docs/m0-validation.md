# M0 技术验证与验收

日期：2026-10-29

## 已提交实现
- Tauri 2 / React / TypeScript / Rust 工程结构及深色工作台。
- 原始 PCM 和 WAV 前三秒首声道读取、归一化，dBFS 与 FFT/波形图。
- M0 合成演示信号与三项 Rust 数值回归测试。
- ffprobe 诊断（仅识别本机程序，未打包、未解码）；GitHub Actions 工作流。

## 验收证据

- 源码提交：已完成。
- npm 前端编译：待 GitHub Actions 验证。
- Rust 核心测试：待 GitHub Actions 验证。
- Tauri Windows 编译：待 GitHub Actions 验证。
- FFmpeg 多格式解码及 sidecar 打包：**未实现，待 M1**。
- WebGL2 时频谱技术验证、IPC 大规模传输和 1GB 压测：**未执行**。
- Windows 离线安装：**未执行**，bundle.active 当前设为 false。
- 锁文件：待在具备网络与 Rust 工具链的环境生成并提交。

## 数值与范围说明

- 峰值与 RMS dBFS 基于归一化第一声道预览数据。
- FFT 使用 4096 点 Hann 窗，相干增益修正，输出单音幅度谱 dBFS，并非 PSD。
- 静音返回 null 表示负无穷 dBFS，JSON 不直接传递 Infinity。
- 用户输入的 PCM 采样率用于解释样本时间轴，不执行重采样。
- M0 必须通过 CI、侧载程序验证以及 FFmpeg 许可可行性验证后，才能宣布完全达标。

## 后续阻塞
1. 检查/修复 CI 构建失败，补齐 npm/Cargo 锁文件。
2. 审核并集成 ffmpeg/ffprobe 合规 sidecar，形成无外部依赖的离线应用包。
3. Windows 真机 UI、性能和 1 GB 文件分析压测；验证 WebGL2 降级路径。
