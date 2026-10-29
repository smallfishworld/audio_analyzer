# Audio Analyzer — M0 / M1 代码审查与推进记录

> 日期：2026-10-29  
> 审查范围：main@ca4fc96（M1 首批合并之后）  
> 修改分支：fix/review-m0-m1-hardening  
> 说明：以下状态区分“已实现”“CI 已通过”“尚需 Windows 真机验证”，避免把技术原型包装为完整版。

## 1. 总体结论

- **M0：核心工程闭环通过 CI，但不能按完整初始定义宣布全部验收**。Tauri 2、React、Rust、专业深色工作台、WAV/RAW PCM 预览、FFT/dBFS 单测、Windows NSIS 安装包已经具备。Windows 真机运行、WebGL2/Canvas 性能 Spike、1 GB 文件性能测试、可复现构建锁文件以及 FFmpeg 合规分发尚未关闭。
- **M1：第一阶段多格式解码通过 CI，但 M1 未全部完成**。Rust + FFmpeg 的八种编码/容器合成音频测试已通过，元数据可读取；安装包仍需要运行机自行提供 FFmpeg/ffprobe，整文件分析、缓存、任务取消、更多多声道交互及完整格式矩阵没有完成。
- 以 GitHub Actions 为验收来源：M0 run #5 https://github.com/smallfishworld/audio_analyzer/actions/runs/40880828477；M1 run #16 https://github.com/smallfishworld/audio_analyzer/actions/runs/40885323644，后者 4/4 jobs success 且生成 M1 Windows installer artifact。

## 2. 本次代码审查发现的问题

| ID | 严重性 | 代码位置 | 发现 | 处理 |
|---|---|---|---|---|
| R01 | 高 | crates/audio-core/src/ffmpeg.rs | ffprobe/ffmpeg 原先 Command::output() 一次收集 stdout/stderr，没有可靠超时和进程输出内存上限；坏文件或异常解码可能长期占用资源 | **本次修复**：新增 bounded process runner、输出容量、watchdog 超时，子进程结束后回收 |
| R02 | 中高 | crates/audio-core/src/lib.rs | WAV/裸 PCM 只固定 CH1；planar 虽可导入，却不能查看其他通道 | **本次修复**：通用 channel index，interleaved/planar 根据不同布局正确定位通道，非法通道返回错误 |
| R03 | 中高 | crates/audio-core/src/ffmpeg.rs | ffmpeg pan 固定 c0，任何多声道音频无法对照其他声道 | **本次修复**：通过验证过的 channel index 选择 cN，八格式集成测试增加第二声道 |
| R04 | 中 | src/App.tsx | 主线程使用异步分析时，旧任务完成可能覆盖后一次选择的结果；界面固定显示 CHANNEL 1 | **本次修复**：请求序号丢弃过期结果、展示通道选择器与正确标签 |
| R05 | 高 | Windows packaging / tech.md | 音频多格式支持依赖外部 FFmpeg；NSIS 包不随包带受审计 decoder | **未关闭**：必须完成 LGPL/GPL 构建选项、版权声明、可执行文件来源和 Windows 离线测试 |
| R06 | 高 | crates/audio-core/src/lib.rs | 目前固定最多 3 秒/576000 采样点，只返回预览值，不能测量整文件/选区 | **未关闭**：下阶段分块数据流、异步 LOD 波形缓存、选区统计及进度/取消 |
| R07 | 中 | dependencies / CI | npm package-lock.json、Cargo.lock 未纳入版本控制；CI 使用新解析依赖 | **未关闭**：需要锁定依赖，并将构建更新到 npm ci / cargo --locked |
| R08 | 中 | frontend/graph/DSP | FFT 固定 4096 Hann；不支持 PSD、STFT、对数频轴完整控制/导出 | **M2/M3**，不得在 M1 验收中声称完成 |
| R09 | 中 | test/deployment | CI 编译不代表真实 Windows 10/11 安装、UI、兼容性、SmartScreen/离线 WebView2 | **未关闭**：真机测试与截图验收 |
| R10 | 中 | codec/metadata | ALAC、WMA/APE/CAF、更多损坏音频与长文件未进入自动化测试；有损样本的编码延迟边界待评估 | **未关闭**：逐格式验证兼容矩阵 |
| R11 | 中 | process/decoder | 尽管增加了子进程超时，尚未实现完整进程树沙箱/取消队列、文件权限/句柄资源压力测试 | **未关闭**：作为 M1 后续性能安全专题 |
| R12 | 低 | UI/README | 语言与图表高级设置、主题切换/最近文件/拖放等产品体验功能未实现 | **未关闭**：按 spec 排入后续迭代 |

## 3. 本次推进内容（待新 CI 最终验证）

1. 可靠进程运行器：限制 ffprobe JSON（1 MiB）、FFmpeg PCM 输出（按采样率与预览长度计算）、stderr（32 KiB），并为探测/解码分别设置超时；并发读取管道避免 pipe deadlock。
2. 支持 CH1…CHn 的独立查看：WAV、裸 PCM interleaved/planar、FFmpeg 多格式的统一声道索引。
3. UI 添加 Channel 下拉菜单，针对当前文件重新分析被选择的通道；引入请求序号避免旧分析结果覆盖新界面。
4. Rust 单元测试覆盖第二声道、越界、interleaved/planar；八格式集成测试覆盖第二声道解码。
5. 保留 M1 Preview 的明确限制：不是全文件测量，不提供专用多 MIC 一致性算法，依赖外部 FFmpeg 才能分析压缩格式。

## 4. 未来实施顺序

### P0：关闭 M1 真正可用的门槛
- 合规 FFmpeg/ffprobe sidecar 和可复现构建，Windows 安装后无需额外 PATH 配置。
- 音频流分块读取、整文件波形 LOD 缓存、任意时间选区的 RMS/Peak 与 FFT，进度/取消。
- 准确的通道和流切换、文件失效/损坏/大文件异常恢复。
- Windows 实机安装/关闭/二次打开、真实 WAV/PCM/MP3/AAC/FLAC 测试和离线模式验收。

### P1：关闭 M0 余项并提升工程质量
- 锁定 Node/Rust 依赖，CI 改用锁定模式并缓存构建结果。
- WebGL2 与 Canvas fallback 技术 Spike、1 GB 音频的 CPU/内存/IPC 传输基准测试。
- 更多 PCM 端序/位深/平面布局、损坏头、带时间戳音频的精度测试。
- 报告真实兼容格式矩阵、适用平台及免责声明。

### 之后按原技术路线
- M2：可配置 FFT 点数/窗函数、精准频点测量、功率谱密度（PSD）、显式重采样、CSV 导出。
- M3：STFT 时频谱、可配置采样率与码率的音频导出、Windows 稳定发布。
- M4：高级测量、更多编码、macOS/Linux 包。

## 5. 验收要求

- 每次改动必须至少通过前端 build、Rust core tests、八格式 FFmpeg probe/decode、Windows cargo check 与 NSIS build。
- 新增的 channel index 必须对非法序号报错且不读错通道。
- Windows 安装包必须按实际依赖能力描述；没有 sidecar 就不能宣称下载即支持 MP3/AAC/FLAC。
- 不允许仅靠漂亮 UI 或单纯的合成音频 FFT 单测宣布“专业声学校准完成”。
