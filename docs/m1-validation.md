# M1 多格式音频导入 — 阶段验证记录

> 日期：2026-10-29
> 状态：M1 第一阶段预览（0.2.0-alpha.1），M1 全部目标尚未完成
> 对应需求：[spec.md](../spec.md) / [tech.md](../tech.md)

## 已实现源码

| 功能 | 状态 | 说明 |
|---|---|---|
| FFmpeg 媒体解码适配器 | 已实现源码 | 使用 ffprobe/ffmpeg，Rust 统一接收 f64le |
| 文件元数据 | 已实现源码 | codec、容器、采样率、声道、码率、时长、位深（可得时） |
| 多格式离线读取 | 部分完成 | 不访问云端；运行机需提供 ffmpeg/ffprobe |
| 裸 PCM planar/interleaved | 已实现源码 | 用户可指定排列方式 |
| PCM 导入参数保存 | 已实现源码 | 本地存储上次参数 |
| 格式回归 | CI 验证 | WAV、AIFF、FLAC、MP3、AAC、M4A、OGG、Opus 合成样本 |
| 多声道和整文件读取 | 未完成 | 仅分析首声道、最多 3 秒/576000 帧 |
| Windows 自带 FFmpeg | 未完成 | 未经许可核验的二进制不随包发布 |
| 进度/取消/多文件并行 | 未完成 | M1 后续开发 |

## 核心技术约束

1. 标准音频的采样率、码率均来源于真实文件元数据，只读展示；裸 PCM 通过明确指定参数解释。
2. 频谱按原采样率测量，不隐式重采样；有损编码的分析结果以解码后的信号为准。
3. 使用明确的 ffmpeg 音频 stream index 和 pan=mono|c0=c0 保留首声道，避免默认混声。
4. FFmpeg 使用固定参数的独立进程，不调用 shell；媒体的输入限制为本地文件，禁用网络协议。
5. 优先使用与应用一同分发、已获许可证审核的 ffmpeg/ffprobe，开发机允许从 PATH 查找。
6. 后台线程读取文件与计算分析数据；预览设有帧数上限，当前 UI 严格注明 preview。
7. FFT、RMS、Peak 都在 Rust audio-core 计算，不依赖浏览器实现。

## 待完成与风险

- 完成 FFmpeg LGPL 构建、依赖许可证/编解码器专利审查，再将其纳入 Windows 离线安装包。
- 可靠子进程超时/取消与 stderr 上限，坏文件和大文件安全性验证。
- 完整多声道独立查看、全文件分块缓存、进度状态、更多裸 PCM 测试向量。
- 依赖锁文件、格式兼容矩阵以及 Windows 实际安装/使用验收。

## 测试记录

见 GitHub Actions。只有具体工作流跑完并通过后才记录为成功。测试包括：Rust core 单测、8 种合成格式 probe/decode_preview、错误媒体处理、前端构建、Windows Tauri 编译与 NSIS 打包。

## CI 验证记录

- PR #2: https://github.com/smallfishworld/audio_analyzer/pull/2
- CI #11: https://github.com/smallfishworld/audio_analyzer/actions/runs/40884900275
- 已确认通过：前端 TypeScript/Vite、Rust core 单元测试、8 种格式 Rust 集成解码测试。
- Windows 编译/安装包构建：以工作流最终结论为准；未经过 Windows 实机启动与安装验收。
