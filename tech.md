# Audio Analyzer — 技术选型与总体技术方案

> 文档版本：v1.0.0  
> 日期：2026-10-29  
> 状态：技术选型已确定，实施前需通过 M0 技术验证  
> 对应需求：[spec.md](./spec.md) v2.0.0（分析专用，不包含音频编辑）  
> 仓库：https://github.com/smallfishworld/audio_analyzer  
> 目标：免费开源、离线优先、专业测量、精美 GUI、多音频格式兼容的桌面分析软件。

---

## 1. 选型结论（决策摘要）

**最终推荐：Tauri 2 + React + TypeScript + Rust + FFmpeg sidecar + realfft/rustfft + uPlot + WebGL2。**

各项决策如下，依赖小版本在 M0 验证通过后锁定并提交 lockfile，而非无依据地采用“最新版”。

| 分层 | 选型 | 决策 | 作用 |
|---|---|---|---|
| 桌面应用 | Tauri 2 | 采用 | Windows 与 macOS ARM64/Intel 双平台；Linux 后续 |
| 前端框架 | React + TypeScript + Vite | 采用 | 工作台、多面板和高交互 UI |
| UI 样式/控件 | Tailwind CSS + Radix UI primitives + Lucide icons | 采用 | 精致、可定制、无障碍，避免臃肿设计框架 |
| UI 状态 | Zustand | 采用 | 文件、选区、视图参数与任务状态 |
| 核心语言 | Rust | 采用 | 统一解码任务调度、DSP 与缓存 |
| 裸 PCM | Rust 原生 Reader | 采用，P0 | 无文件头参数化解析、大小端、交错/平面 |
| 编码文件解码 | FFmpeg + ffprobe，作为打包的 sidecar | 采用，P0 | WAV、AIFF、FLAC、MP3、AAC、M4A、Ogg/Vorbis、Opus 等 |
| 格式优化备选 | Symphonia | 暂不作为 P0 必须依赖 | 若 FFmpeg 启动/seek 性能成瓶颈，可用于部分格式 |
| FFT | realfft + rustfft | 采用 | 单边实数频谱、STFT 及频域运算 |
| 重采样 | rubato | 采用 | 用户主动选择分析采样率/输出采样率 |
| 波形和频谱 | 专用 Canvas2D 波形包络 + uPlot 频谱 + Rust 分块缓存 | 采用，A0 | 全幅 min/max 波形、时间标尺与频率谱分工，不能画两条 min/max 平线 |
| 时频谱 | WebGL2 自研纹理瓦片层 + Canvas2D 回退 | 采用，M3 | 大时频矩阵高效渲染，完整控制 dB 色标 |
| 播放 | P0 优先验证 Rust/系统音频输出后端 | 待 M0 验证 | 试听不进入专业分析链路 |
| 设置/缓存 | JSON 配置 + 本地二进制分层缓存 | 采用 | 不引入数据库做首版前提 |
| 测试 | cargo test、Vitest、Playwright、平台端到端测试 | 采用 | 对格式、数值、UI 和安装包独立验收 |
| CI/CD | GitHub Actions + 平台打包 | 采用 | Windows + macOS ARM64/Intel CI；Linux 后续 |

**重要原则**：FFmpeg 专门负责媒体容器/编解码，Rust DSP 专门负责测量；前端不参与 dBFS、FFT 归一化等核心计算。浏览器 Web Audio API 不作为测量数据源。

**范围边界**：项目仅做只读音频分析与可视化，可提供辅助分析的试听。**不实现音频剪切、混音、多轨、降噪效果器、音频内容处理或录音工作站**；也不实现专用多 MIC 一致性/产线良率算法。多声道文件浏览、频谱叠加、时间选区和结果导出属于分析功能。

## 2. 选型依据与方案比较

### 2.1 桌面框架

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Tauri 2 + Rust + Web UI | Rust 计算内核自然集成、UI 设计自由度高、跨平台、可打包 sidecar | 依赖系统 WebView，不同平台需兼容验证 | **首选** |
| Qt 6 + C++ / QML | 成熟原生桌面与绘图能力、适合硬件工具 | 开发和设计成本较高，Qt 许可和部署需要逐项评估 | 备选，特别适合纯 C++ 团队 |
| Electron + React + Node.js | 生态成熟、Web 行为跨平台较一致 | Chromium 打包体积和基础内存开销较大，还需原生 DSP 桥接 | 不选 |
| Python + PySide6 + NumPy/SciPy | 算法原型开发快、科学计算库丰富 | 生产环境打包、启动、分发、长文件性能和原生依赖管理复杂 | 仅用于验证算法与参考对照 |

**决策理由**：产品的差异化在专业测量、裸 PCM 导入以及高质量交互；Rust 适合大数据量处理，React 适合精美可交互工作台，Tauri 是两者之间的工程化桥梁。

### 2.2 解码方案

| 方案 | 优势 | 风险 | 决策 |
|---|---|---|---|
| 纯 Rust：Symphonia | 集成干净、跨平台分发方便、常见格式支持好 | 格式/codec 覆盖与 gapless 支持边界需逐项验证；不能默认覆盖 Opus 及所有 AAC 变体 | 保留为将来优化 |
| FFmpeg CLI sidecar | 容器/编解码覆盖广、能通过 ffprobe 获取元数据、导出参数丰富 | 进程启动开销、seek 与大量局部请求、许可证合规、各平台二进制分发 | **P0 采用** |
| 直接绑定 libavcodec/libavformat | 可低开销流式调用与复用上下文 | FFI、ABI、动态库版本和打包维护成本高 | P1 性能瓶颈后评估 |
| 浏览器 AudioContext | UI 集成简单 | 依赖 WebView 媒体支持，裸 PCM 与专业数值精度不可控 | 不选 |

**解码策略**：
- .pcm/.raw/.bin：用户指定采样格式，直接 Rust 解析；不交给 FFmpeg 猜测参数。
- WAV/AIFF/FLAC/MP3/AAC/M4A/Ogg/Opus 等：优先 ffprobe 探测，FFmpeg 解码为统一内部样本流。
- 解码能力与容器格式分开验收。比如 .m4a 可能装 AAC 或 ALAC，不能以扩展名假定 codec。
- 各格式都必须维护通过实测的兼容矩阵，未测过的变体不声称完全支持。
- 不支持 DRM 解密，异常编码提示可理解的原因。

### 2.3 FFT、重采样及绘图选择

- **realfft + rustfft**：均为纯 Rust 方案，实数音频无需扩展为完整复数谱；重用 FFT planner、窗口向量与工作缓冲区，减少重复分配。
- **rubato**：用于明确请求的重采样，并选择固定比率高质量重采样器；有源采样率与分析采样率的独立标识。不允许为了显示方便而悄悄改变采样率。
- **Canvas2D 波形专用层**：读取 Rust 的 min/max 波形包络，按时间桶绘制峰值竖线或填充而非两根 min/max 折线；显示时间标尺、选区、播放头和零线。缩放到现有包络分辨率不足时必须请求当前可视区的更高 LOD，不得无界放大 1200 桶数据。
- **uPlot**：用于频率分析曲线的网格、光标和频谱缩放；必须导入 uPlot 自带 CSS，否则图表标尺和画布可能布局异常。
- **WebGL2**：用于 STFT 时频谱图的纹理瓦片，着色器实现可配置 dB 动态范围和色图；若设备/驱动不支持则降级为 Canvas2D，功能保留但性能可能下降。
- 不使用 ECharts 等通用大图表框架承载全分辨率波形；若采用某库须先验证密集曲线性能。Plotly 可用于原型，非首版核心引擎。

## 3. 系统总体架构

    ┌─────────────────────────────────────────────────────────────────────┐
    │ Tauri WebView / React UI                                            │
    │ 文件列表 │ 波形(Canvas2D) │ 频谱(uPlot) │ 时频谱(WebGL2) │ 测量     │
    └──────────────────────────────────┬──────────────────────────────────┘
                                       │ typed invoke / Channels
    ┌──────────────────────────────────▼──────────────────────────────────┐
    │ Rust Application Service                                           │
    │ File Session / Task Manager / Cancellation / Metadata / Cache       │
    ├──────────────────────────────┬──────────────────────────────────────┤
    │ Audio Source Abstraction     │ DSP Engine                           │
    │   ├─ RawPCM Reader           │   ├─ time-domain: Peak/RMS/DC        │
    │   └─ FFmpeg Decoder Adapter  │   ├─ realfft/rustfft: FFT/STFT       │
    │        ├─ ffprobe metadata   │   ├─ band power / cursor readouts    │
    │        └─ ffmpeg pipe        │   └─ rubato explicit resampling      │
    ├──────────────────────────────┴──────────────────────────────────────┤
    │ Layered waveform cache / Spectrum cache / Spectrogram tile cache   │
    │ Export: CSV, PNG, WAV/FLAC/MP3/AAC/raw PCM                           │
    └─────────────────────────────────────────────────────────────────────┘
                          │                       │
                          ▼                       ▼
                   local audio files       local settings/cache
                   (source read-only)      (user-writable)

**数据流**：

1. UI 请求打开本地文件，Rust 创建 FileSession，并返回文件 ID、可用流和真实元数据。
2. 裸 PCM 由用户提供 AudioImportSpec；标准格式由 ffprobe 探测；检测失败时提供手动解释入口，但不假设猜测可靠。
3. Rust Decoder 接口产出分块、分声道的 PCM 样本流和原始时间基准信息。
4. Rust 逐块构建波形 min/max 金字塔与时域统计；按选区异步计算 FFT、STFT。
5. UI 只请求当前视口的可视样本数量或频谱结果，绝不整体接收原始长音频。
6. 用户改变 PCM 解释参数、FFT 参数、选区或分析采样率时生成新的任务世代号；旧结果被丢弃。
7. 导出由 Rust 创建新文件，支持取消及临时文件原子提交，不覆盖原始源文件。

### 3.1 核心 Rust 领域对象（概念接口）

    AudioSource
      open(spec) -> AudioSession
      metadata() -> AudioMetadata
      read_frames(start_frame, frame_count, channel_mode) -> PcmBlock
      close()

    AudioImportSpec
      path, sample_format, endianness, sample_rate_hz
      channels, layout(interleaved|planar), byte_offset

    AnalysisSpec
      source_id, selection(start_frame, end_frame), channels
      fft_size, window, averaging, spectrum_unit
      optional_analysis_sample_rate_hz, resampler_quality

    ExportSpec
      output_path, container, codec, sample_rate_hz, channel_layout
      pcm_format?, bitrate_bps?, rate_control?, quality?, selection?

    MeasurementResult
      source_id, generation_id, channel, range, units
      peak_dbfs, rms_dbfs, dc_offset, clipping_count
      frequency_bins?, spectrum_values?, measurement_metadata

定义：
- **sample_rate_hz** 为源或目标的物理采样率，不是 UI 显示倍率。
- **bitrate_bps** 仅适用于编码器支持的目标码率；无压缩 PCM 按数据格式推算有效数据码率。
- **selection** 使用整数样本帧索引来避免时间浮点累计误差。
- **generation_id** 用于取消/拒绝已经过时的异步计算结果。
- **units** 和 measurement_metadata 必须随每组频谱数据返回，避免同一“dB”标签被误用。

### 3.2 Rust 与 UI 边界

- Tauri commands 只处理小型请求及结果元数据，如 open_audio、get_waveform_lod、analyze_spectrum、get_spectrogram_tile、export_audio、cancel_task、list_encoder_capabilities。
- UI 持有文档 ID、任务 ID、当前视口和显示参数，不管理任何 Rust 原始指针。
- 任务进度通过 Tauri Channels 或事件推送；大规模时频数据使用带版本号的分块/二进制传输，M0 验证 WebView/IPC 的实际开销。
- 不在 React 中执行重度 FFT，也不通过一次 JSON RPC 返回整段 PCM。
- Rust 的解码、DSP 与本地缓存不依赖 Tauri API，作为纯 Rust crate 可独立测试，并为未来 CLI 预留能力。

## 4. 多格式音频解码技术设计

### 4.1 输入策略

**裸 PCM Reader（Rust 原生）**

- 按 spec.md 的 P0 类型支持 u8、i8/i16/i24/i32、f32/f64；对多字节类型支持大小端。
- 支持 1–16 声道、interleaved/planar、文件头偏移，按帧完整性校验；最后一帧不足时提示。
- i24 三字节手动拼接、符号扩展；整数归一化使用有符号满幅分母 2^(bits-1)，u8 使用 (value-128)/128。
- 样本索引、字节偏移采用 64 位整型并执行溢出检查；不读取超出用户选择的文件范围。
- 输入浮点无声级重标定，>1.0 的样本保留并标记超幅；对 NaN/Inf 提示并定义排除策略。
- 改变采样率对裸 PCM 首先是**重新解释样本时间轴**，不对数据做重采样；与“分析阶段重采样”完全区分。

**已封装音频：FFmpeg + ffprobe**

- ffprobe 读取 streams、format、codec_name、sample_rate、channels、channel_layout、sample_fmt、duration、bit_rate 等可用字段。某些字段本身可能未知或不可靠，应保留“未知”而非编造。
- 只选择音频流；多音轨输入需展示可选音频流，默认首个有效流，不解码封面/视频流。
- FFmpeg 通过子进程 stdout **分块输出**线性 PCM（建议分析高精度路径使用 f64le，渲染/试听可按需要转换为 f32），stderr 单独持续读取，避免缓冲阻塞；对失效进程提供错误与退出码。
- 对超长媒体按片段解码、限制缓冲；seek 的时间戳误差、codec delay、padding 与 gapless 行为纳入回归测试，不能假设所有编码器精确随机定位。
- 先保持原始采样率/声道，不自动做 downmix、dynaudnorm、volume、重采样或格式修饰滤镜。
- 命令由 Rust 的参数数组构造，不通过 shell 字符串拼接；限制输入为本地用户选中的常规文件和受控内部 pipe，禁止外部 URL、网络协议及用户自定义 FFmpeg 命令。
- 文件解析及解码过程应支持明确超时、任务取消、进程树清理及资源限制；检查无网络时行为。

### 4.2 FFmpeg 作为 Tauri sidecar

- 使用 Tauri 2 的 bundle.externalBin 打包受控版本的 ffmpeg 与 ffprobe，并按 target triple 命名平台二进制。
- **仅 Rust 后端有权启动 sidecar**；不在 UI 开启任意 shell 执行权限。访问权限严格按 Tauri capability/security 模型约束。
- M0 验证 Windows x64、macOS aarch64、Linux x64 的封装路径、签名要求、运行时依赖和 offline 首次启动。
- 不从随机第三方地址下载无法审计的静态二进制。构建脚本记录版本、配置、许可证、SHA-256；本地或 CI 生成可复现分发清单。
- FFmpeg/ffprobe 版本和编码器能力在启动时检测，保存本次会话的真实能力表。
- 后续若增加 Symphonia，Decoder 接口仍要保证相同格式同一解码链路的结果一致，避免混用不一致增益或 channel mapping。

### 4.3 格式支持矩阵（规划，不等于实现）

| P0 输入 | 目标路径 | 风险点 |
|---|---|---|
| PCM/RAW/BIN | Rust RawPCM | 原始参数、i24、大端、planar、偏移 |
| WAV/BWF/AIFF | FFmpeg；必要时原生 PCM 快路径 | PCM 格式、扩展 chunk、元数据及字节序 |
| FLAC | FFmpeg | 位深、无损一致性、通道标签 |
| MP3 | FFmpeg | 码率字段、encoder delay/padding |
| AAC(.aac)/M4A/MP4(ALAC) | FFmpeg | ADTS/ISO BMFF 区别、AAC profile、音轨选择 |
| OGG/Vorbis | FFmpeg | Ogg 容器及 Vorbis 编码实际识别 |
| Opus(.opus/.ogg) | FFmpeg | pre-skip、encoder delay、时长与时间线 |
| 其他格式 | P1 逐项加到兼容矩阵 | WMA/APE/WavPack/CAF 等不能只凭扩展名承诺 |

### 4.4 输出编码参数与实施顺序

| 输出 | 可配置参数 | 处理规则 |
|---|---|---|
| RAW PCM | 采样率（赋予目标样本时间基准）、位深、字节序、声道、layout | 真正重采样/量化/重排列，另存源文件 |
| WAV | 采样率、PCM 类型/位深、声道 | PCM 码率自动推算 |
| FLAC | 采样率、位深、声道、压缩级别 | 无损压缩不提供独立“目标码率” |
| MP3 | 编码器支持的采样率、声道、目标码率、CBR/VBR | 码率范围由 encoder capability 验证 |
| AAC / ADTS / M4A | 编码器支持的采样率、声道、码率/质量、容器 | ADTS 与 M4A 需要明确选择和校验 |

- 输出参数是一个 **validated ExportSpec**，不能直接把用户填的任意文字传给 ffmpeg。
- 输出采样率如果与源不同，应调用明确的重采样链路；可优先用 rubato 产生统一的目标 PCM，然后调用 FFmpeg 编码，或者在充分验证后委托 FFmpeg 的 swresample，**每条导出链路只有一个生效的重采样器，避免重复重采样**。
- 默认不自动增益归一化、不压缩动态范围、不混音；声道变化必须由显式配置触发。
- 输出先写同目录临时文件，成功后原子替换/重命名目标（按平台限制处理）；取消时删除临时文件，并禁止源文件作为目标。
- 编码器能力以**实际随包构建**为准。尤其 MP3、AAC 编码器与 CBR/VBR 支持需 M0 端到端试验，不因 FFmpeg 理论支持便宣称支持。

## 5. DSP 数值设计：dBFS、FFT、PSD

### 5.1 内部计算精度

- Sample Peak/RMS/均值/DC Offset 使用 Rust f64 累积；特别长文件采用稳定分块累加算法，必要时做补偿求和或分块聚合。
- 原始整数/浮点 PCM 保留原始样本信息；解码转换与重采样信息进入 measurement_metadata。
- FFT 首版优先 f64 保证测量一致性；时频谱海量像素缓存可按测试结果使用 f32 dB 幅值/纹理数据。
- 不把试听音量或 UI 轴缩放带入计算。
- 静音明确显示 -∞ dBFS；对 NaN/Inf、无样本、数据不完整分别使用不同状态而非伪造 0 dBFS。

### 5.2 精确计算约定

- 对归一化单声道样本 x[n]，Sample Peak dBFS = 20 log10(max(|x[n]|))。
- RMS dBFS = 20 log10(sqrt(sum(x[n]^2) / N))。
- 单音幅值谱使用 FFT 结果按窗函数相干增益（sum(window)/N）归一化；单边谱内点补偿 ×2，DC/Nyquist 不补偿。
- 对窗函数与非整周期频率的频谱泄漏作注释；“频点 bin 幅值”与“峰值插值估计”分开显示。
- 功率谱与 PSD（Power Spectral Density，功率谱密度）是单独模式，应基于窗能量 sum(w²)、采样率和正确单边谱修正，不能简单复用幅值 dBFS 公式。
- 分析时间范围用整数样本帧索引，时频谱的 hop size 与首窗时间定位统一。
- Nyquist = Fs / 2；当 Fs=96 kHz，47 kHz 已临近 Nyquist；不能显示 48 kHz 以上的真实输入内容。
- 码率（bps）指编码数据率，不是电平；只展示文件信息/输出参数，不参与 FFT 的幅度计算。

**验证向量**：
- 零信号、DC、负满幅、浮点超幅。
- 1 kHz 单音、48 kHz、峰值 0 dBFS → RMS 约 -3.0103 dBFS（采样与周期条件满足时）。
- -6 dBFS 峰值正弦、整数周期、矩形/Hann 窗幅值校正。
- 2–47 kHz 线性/对数扫频，192 kHz 采样。
- 噪声 PSD 和总功率积分的 Parseval 一致性对照。
- 音频有损导出后重新导入：只验证重新解码后的结果与可解释变化，不要求与原 PCM 样本逐点相等。

## 6. 前端图表与交互实现

### 6.1 设计系统

- 深色为默认，浅色可切换，使用语义化设计令牌（背景/文本/次要文本/网格/坐标/数据系列）。
- 工作台布局：可收起文件栏、波形/频谱/时频谱三区、右侧测量与参数区，避免音乐剪辑软件式的时间线堆叠。
- 字体：系统字体栈；读数采用表格数字。不要把外部专有字体文件直接提交或随包分发。
- 前端专注视觉效果、键盘鼠标交互和无障碍，不在 UI 重新推导 FFT、dBFS。
- 图表必须支持双光标 Δf/ΔdB/Δt、坐标线性/对数、选区联动、导出时附单位与分析参数。
- 使用 CSS 变量/主题令牌统一控制颜色，减少界面过多渐变、发光装饰对数值识别的干扰。

### 6.2 波形/频谱渲染

- Rust 构建 waveform min/max 层级缓存：每层保留块的 min/max（而非简单均值），防止瞬时峰值在缩小时消失。
- 根据视口像素宽度请求指定 LOD（Level of Detail，细节层级）；例如宽 1600px，传输对应的数千对 min/max，不是全部样本。
- 频谱图 Rust 返回频率数组、幅值数组、单位/归一化信息。显示时可做保峰值降采样，但精确光标读数回查原始 FFT bin。
- 波形使用独立 Canvas2D 时间轴/包络渲染器；频谱继续采用 uPlot。二者由统一的选区/光标时间模型驱动，不直接向 UI 推送全部 PCM 采样。
- 频谱可切换线性/对数频率轴，0 Hz 对数轴需单独显示/排除 DC，不能对 0 取对数。

### 6.3 时频谱瓦片

- Rust 按时间范围与 FFT 配置计算 STFT 矩阵；以频率区间/时间切片生成 tile，支持并行但有内存预算。
- tile 保留 dB 值与测量参数，不先烧制固定颜色，便于用户调节色标和动态范围。
- WebGL2 纹理复用与 LRU（Least Recently Used，最近最少使用）缓存；通过 shader 完成色彩映射。
- Canvas2D fallback 优先保证功能正确，性能降级须在状态栏说明。
- UI 只为当前视口与邻近缓存请求 tile；拖动、缩放不触发整段 1 GB 音频的完整 STFT。

## 7. 大文件、异步调度与缓存

**目标**：约 1 GB 文件可打开、缩放、选区、局部分析，内存不会因音频解码而线性膨胀。性能指标需在基准机器实测后收紧。

- 解码按块进行；小范围频谱允许直接 seek+read；长文件全局统计在后台渐进执行。
- 任务类型：Probe、BuildWaveformLOD、AnalyzeSelection、BuildSpectrogramTiles、ExportAudio。
- 根据交互优先级调度：正在查看的视口数据 > 当前选区 FFT > 后台完整文件统计；长任务支持取消。
- Rust memory cache 使用有上限 LRU；磁盘缓存包含 file fingerprint（路径/大小/修改时间，必要时 hash）、解码器版本、参数和算法版本。
- 缓存有损格式的结果必须含实际选择音轨、解码配置与处理模式；不能混淆不同文件同名的缓存。
- 尽量共享已建立的层级波形数据；依赖 RAM 的可用大小动态调整缓存容量，不定死为整文件预载。
- UI 每次查询带 source_id + generation_id；收到过时数据直接丢弃，避免“参数已经切换而曲线还显示旧值”。

### 7.1 性能验收建议

| 场景 | 最低要求 | 推荐目标（M0/M1 基准后确认） |
|---|---|---|
| 48 kHz、1 分钟 WAV | 导入后能逐步显示波形，不阻塞 UI | 首屏可用 ≤2 s（本地 SSD） |
| 192 kHz PCM | 直接按照参数解释，无须先转换 | 光标响应与拖动保持顺滑 |
| 约 1 GB 音频 | 不因数据规模直接耗尽内存 | 控件交互响应 <100 ms（大多数交互） |
| FFT 改参/选区变化 | 旧任务可取消，结果不会串 | 当前区域结果优先完成 |
| 缩放和平移 | 不传输整文件样本到前端 | 常见视口稳定 ≥30 FPS |
| 时频谱 | 可渐进显示，可降级 Canvas | 可见区域交互稳定 ≥30 FPS |

以上目标不代表已测得的性能；应选定 Windows x64 基准机（例如 4 核、8 GB RAM、SSD，记录 CPU 型号及系统版本）并留存性能报告。

## 8. 工程仓库结构

    audio_analyzer/
    ├─ spec.md
    ├─ tech.md
    ├─ README.md                     （M0 创建）
    ├─ LICENSE                       （许可评估后确定）
    ├─ package.json
    ├─ pnpm-lock.yaml
    ├─ src/
    │  ├─ app/                       应用入口/工作台布局
    │  ├─ features/
    │  │  ├─ files/                  文件列表、源元数据
    │  │  ├─ pcm-import/             导入参数与预览
    │  │  ├─ waveform/               uPlot 波形视图
    │  │  ├─ spectrum/               uPlot 频谱
    │  │  ├─ spectrogram/            WebGL2 瓦片层
    │  │  ├─ measurement/            读数/光标/选区
    │  │  └─ export/                 参数化音频导出
    │  ├─ components/ui/
    │  ├─ lib/ipc/                   类型化 Tauri API
    │  ├─ state/                     Zustand 状态
    │  ├─ styles/
    │  └─ i18n/
    ├─ src-tauri/
    │  ├─ tauri.conf.json
    │  ├─ binaries/                  由 CI 构建/注入；不随意提交第三方二进制
    │  ├─ capabilities/              最小权限
    │  └─ src/
    │     ├─ main.rs
    │     ├─ commands/
    │     ├─ services/
    │     ├─ decoder/                RawPCM / FFmpeg adapter
    │     ├─ dsp/                    stats / fft / stft / units
    │     ├─ resample/
    │     ├─ encode/
    │     ├─ cache/
    │     ├─ tasks/
    │     ├─ export/
    │     └─ error/
    ├─ crates/
    │  ├─ audio-core/                不依赖 Tauri
    │  └─ audio-test-vectors/        测量用固定样本/生成器
    ├─ tests/
    │  ├─ fixtures/                  小型格式测试样本
    │  ├─ e2e/
    │  └─ golden/                    数值标准结果
    ├─ scripts/
    │  ├─ build-ffmpeg/              可复现构建脚本
    │  └─ verify-codecs/
    ├─ docs/
    │  ├─ measurements.md            数学定义和误差公差
    │  ├─ formats.md                 实际可用的格式矩阵
    │  ├─ architecture.md            后续模块细节
    │  └─ third-party-licenses.md    分发许可证
    └─ .github/workflows/

可以在 M0 先把 crates/audio-core 放进 src-tauri 的 workspace，避免一开始过度拆分。目录体现逻辑边界，具体需要的文件按里程碑增量建立。

## 9. 安全、开源许可、离线分发

### 9.1 音频文件与进程安全

- 所有用户输入路径仅能经过受控 FileSession 打开；UI 不开放任意文件系统或 shell 访问。
- 第三方编解码库属于不可信媒体解析面。建议通过独立 FFmpeg 进程隔离，可在任务取消、超时或异常时终止。
- 先做本地文件输入，禁用网络 URL/protocol；音频中的元数据不得作为命令参数或富文本 HTML 执行。
- 容器元数据字段、样本长度、声道数量和 FFT 数量严格校验，避免内存/整数溢出。
- 关闭默认网络请求、遥测、远程资源，Content Security Policy（内容安全策略）仅允许打包资源与必要的本地能力。

### 9.2 许可证合规 —— 必须通过的发布门槛

- FFmpeg 官方说明：其主体为 LGPL 2.1+，启用特定 GPL 组件可改变整个构建的适用许可证。**免费开源不等于不必履行编解码器及许可义务。**
- P0 目标使用可审计的、不开启 --enable-gpl 和 --enable-nonfree 的构建；需要实际验证 MP3/AAC 编码器和所需格式在这种配置下可用。
- 打包发布时记录 FFmpeg 源码版本、完整构建参数、启用的库与许可证，提供相应版权声明、许可证文件、修改差异（如有）及适用源码获取方式。具体义务以实际构建和法律审核为准。
- 不直接下载并重发许可证不明的第三方“全能静态版”FFmpeg。
- 应用自身许可证在 M0 决策，例如 MIT / Apache-2.0 双许可；需核对依赖（特别是 Symphonia 若以后引入、FFmpeg 与 UI 包）兼容性后再创建 LICENSE。
- 输出编码专利或地区限制不能仅凭“开源许可证合规”视为全部解决；发布前按适用市场评估。

### 9.3 Windows 离线安装

- Tauri 2 Windows 使用 WebView2；Windows 11 通常已经带有运行时，但不能据此假设所有目标 Windows 10 都有。
- 正式发布前验证离线安装机。可以提供含 WebView2 离线运行时安装组件的离线安装包，作为可选发布资产，避免所有用户背负固定包体积。
- sidecar 跟随程序发布，用户无需手动安装 FFmpeg/ffprobe；安装包运行时不需联网。
- macOS 需验证侧载签名/公证策略，Linux 需验证 WebKitGTK 与发行版依赖。

## 10. 版本策略与持续集成

- Rust 使用 rust-toolchain.toml 固定工具链，Cargo.lock 提交；前端使用 pnpm-lock.yaml 固定依赖树，锁定 Node LTS 基线。
- Rust fmt/clippy/test + frontend lint/typecheck/unit tests + format/codecs regression 作为 PR 必跑检查。
- Windows NSIS 与 macOS ARM64/Intel DMG 都是 P0 目标；macOS 必须独立测试 WKWebView/Apple Silicon 和 Intel，不能仅凭 CI 编译声称兼容。Linux 仍在 P1。
- 音频测试向量由脚本生成，固定生成器版本和 SHA-256；少量人工听音文件不能替代标准数值测试。
- 可选建立 cargo-audit、npm audit、依赖 License/SBOM（Software Bill of Materials，软件物料清单）扫描及 FFmpeg CVE 跟踪；重大漏洞需支持独立更新 sidecar。
- Github Releases 需要：安装包、校验和、版本说明、格式支持矩阵、第三方许可说明。

## 11. 需要先验证的技术风险（M0 Spike）

| 风险 | 严重程度 | 最小验证实验 | 通过条件 / 回退 |
|---|---|---|---|
| FFmpeg 开源分发许可与 MP3/AAC 编码器 | 高 | 自建 LGPL 配置，实测五种 P0 导出及多格式导入 | 许可证清晰且编码器可用；否则改为备选编码库或调整明确能力范围，不能虚假宣称 |
| FFmpeg seek、启动开销 | 中高 | 对 1GB 文件随机取片段，连续执行 100 次 | 延迟可接受；否则复用工作进程或实现原生快捷解码器 |
| Tauri IPC 大数据传输 | 高 | 比较 JSON 数组、二进制块、视口级请求 | 不做大数组 JSON 批量传输；必要时实现块请求/二进制策略 |
| WebGL2 平台兼容 | 中 | Windows WebView2、macOS WKWebView、Linux WebKitGTK 验证纹理瓦片 | WebGL2 可用；失败时 Canvas2D 降级 |
| 192 kHz 高频 FFT 的幅值误差 | 高 | 标准 1k/47k 正弦与窗函数归一化 | 数值在事先定义的容差内，无 8 dB 级别虚假误差 |
| 重采样输出值与时长 | 高 | 192k→48k、44.1k→48k，分析幅值与持续时间 | 误差可解释、抗混叠正确，不二次重采样 |
| 1GB 文件缓存和交互性能 | 高 | 大文件分块、持续拖动、任务取消 | 无 UI 假死、无内存线性膨胀 |
| 离线安装与 sidecar | 高 | 断网 Windows 10/11 VM 完整安装和格式导出 | 用户不需手动补装 FFmpeg；WebView2 离线方案明确 |

## 12. 开发阶段与技术验收

### M0 — 架构 Spike + 设计系统

1. 创建 Tauri + React + TypeScript/Rust workspace，安装包验证 Windows。
2. 运行 Rust 最小 FFT 算法，和 Python/NumPy 离线结果进行数值对照。
3. 实现简化的 WAV/PCM 打开实验，验证 uPlot 波形缩放及 WebView/IPC 数据传输策略。
4. 随包启动 ffmpeg/ffprobe，对 MP3、AAC、FLAC、Opus 文件完成元数据/解码验证，并检查 FFmpeg 许可证策略。
5. 验证 WebGL2 简单时频 tile 的纹理上传/交互能力。
6. 输出技术 Spike 结果文档，定稿依赖小版本和真正可以分发的 FFmpeg 构建。

**M0 验收：** 构建能离线运行的 Windows 应用原型，具有真实文件加载、基础 FFT 数值显示、可用 sidecar、明确的许可路线。

### M1 — 多格式导入和裸 PCM 分析

- 实现 Decoder trait、PCM 数据模型、FFmpeg adapter、PCM ImportSpec、真实元数据与格式测试矩阵。
- 分块解码、完整波形 min/max 缓存、Sample Peak/RMS/DC 统计。
- 拖拽、文件导航、按通道选中、时间选区和预设持久化。

### M2 — 精确 FFT 及可配置分析

- realfft、窗函数、幅值归一化、PSD 的明确模式和单独测量单位。
- 频谱 uPlot、选区/光标联动与 CSV 导出。
- 显式改变分析采样率、rubato 重采样及数值测试。

### M3 — 时频谱、可配置导出和 Windows/macOS 稳定版

- STFT WebGL2 瓦片与 Canvas2D fallback、图像导出。
- WAV/FLAC/MP3/AAC/PCM 导出；设置采样率/码率/样本精度/声道；重导入结果核验。
- 1 GB 文件性能验证、Windows/macOS 安装包离线测试、许可证清单、macOS Developer ID 签名/公证与正式双平台 Release。

### M4 — 高级分析与更多平台

- LUFS、True Peak、THD+N、频谱叠加、更多容器/编码格式、批处理。
- Linux 打包、Windows/macOS 真机兼容性进一步完善与性能优化。

## 13. 架构决策记录（ADR，Architecture Decision Record）

| ID | 决策 | 状态 | 理由 |
|---|---|---|---|
| ADR-001 | Tauri 2 而非 Electron/Qt | Accepted | Rust 原生 DSP + 优秀 Web UI 权衡最合适 |
| ADR-002 | 裸 PCM Rust 原生解析 | Accepted | 保证用户输入参数可控、无损、无自动猜测 |
| ADR-003 | FFmpeg 以 sidecar 承担 P0 标准格式 | Accepted, license-gated | 覆盖广，分发和解码技术风险需 M0 试验 |
| ADR-004 | 不在前端计算 dBFS/FFT | Accepted | 消除两套计算逻辑与不同浏览器行为 |
| ADR-005 | realfft/rustfft + f64 测量 | Accepted | 数值一致性与可测性优先 |
| ADR-006 | uPlot 处理 1D 图表，WebGL2 处理 STFT | Accepted, perf-gated | 控制性能、渲染风格与复杂度 |
| ADR-007 | 不静默重采样/改变源文件 | Accepted | 保留专业测量可信度 |
| ADR-008 | 音频导出与目标码率设置纳入 P0 | Accepted | 与 spec.md v0.2.0 对齐 |
| ADR-009 | SQLite/云端/多人协作非首版前提 | Accepted | 降低过度设计和运维成本 |

## 14. 官方资料与实施参考

以下链接用于实施时复核 API、许可证、部署约束；实际版本以项目锁定版本为准。

1. Tauri 2 文档：https://v2.tauri.app/  
2. Tauri sidecar：https://v2.tauri.app/develop/sidecar/  
3. Tauri Rust/Frontend IPC：https://v2.tauri.app/develop/calling-rust/  
4. Tauri Windows 离线安装：https://v2.tauri.app/distribute/windows-installer/  
5. FFmpeg 法律与许可：https://ffmpeg.org/legal.html  
6. ffprobe 文档：https://ffmpeg.org/ffprobe.html  
7. rustfft：https://docs.rs/rustfft/latest/rustfft/  
8. realfft：https://docs.rs/realfft/latest/realfft/  
9. rubato：https://docs.rs/rubato/latest/rubato/  
10. uPlot：https://github.com/leeoniya/uPlot  
11. Symphonia（备选）：https://docs.rs/symphonia/latest/symphonia/

---

**本技术方案已选定主要方向，但尚未编码、打包或通过性能测试。M0 需优先消除 FFmpeg 许可/编码器、Tauri 离线安装和大文件数据传输三项发布阻塞风险，然后进入工程实施。**


## 附录 A：macOS P0 选型修订（2026-10-29）

- macOS 不再延期到 M4：M0/M1 即建立 ARM64（Apple Silicon）与 x86_64（Intel）两种 native .app/.dmg 构建。
- Tauri 2 自动合并 `src-tauri/tauri.macos.conf.json`，将 Windows 的 NSIS 目标替换为 `app,dmg`，图标使用 Apple .icns。
- CI 使用 GitHub `macos-15` 与 `macos-15-intel` runner；采用 Apple `iconutil`、`codesign`、`hdiutil` 校验，而不是跨系统伪造 macOS 安装包。
- 预览版设置 ad-hoc 签名（`signingIdentity: "-"`），正式发行前必须接入 Apple Developer ID 签名/Notarization；正式发行不可将 ad-hoc 冒充公证。
- Finder 不继承常见 shell PATH，Rust 在 macOS 按 /opt/homebrew/bin 和 /usr/local/bin 等常用位置寻找用户自己安装的 FFmpeg；开发内测未随包附带 FFmpeg。
- 详细 CI、分发和平台验收见 [macOS 验证文档](./docs/macos-validation.md)。


---

## 技术方案修订：A0 波形显示可靠性（2026-10-30）

本节优先于旧 M0–M4 计划中关于波形的实现顺序，基于 [SPEC 2.0](./spec.md) 的分析专用产品边界。

### 当前已识别问题

1. 旧 React 组件将 Rust 的 `WavePoint {timeSec,min,max}` 作为两组 `uPlot` series 连线；对于高频正弦波，每个时间桶的 `min≈−1, max≈+1`，导致屏幕显示两条横线，无法直观看到波形包络。
2. 旧界面双列图表使波形占用面积过小；信息卡片抢占了主视觉位置。
3. `uPlot` 样式未单独导入，可能引起图表布局与交互控件异常。
4. 缺少统一、显式的时间标尺、缩放/选区反馈与 Fit All 操作；缩放后的音频细节必须严格标注数据分辨率。

### 本次修复

- 新增 `WaveformView.tsx`：全宽 Canvas2D + DPR 适配 + 时间标尺 + 零线 + 峰值包络绘制，直接消费按时间递增的 min/max 桶。
- 通过指针捕获实现选区，采用非 passive 原生 wheel listener 避免滚轮缩放触发整页滚动。
- Zoom In/Out、Zoom to Selection、Fit Entire File、双击复位；当前第一阶段的缩放范围受到包络分辨率限制，不宣称样本级精度。
- 现有 `uPlot` 仅绘制频谱，并加载库官方 CSS。
- 不新增任何编辑命令；整个波形画布始终只读。

### 尚未完成（不能声明 A1/A2 已实现）

- 按时间视口从 Rust 异步请求样本级/多级 LOD 数据，Overview 导航框、多声道同步波形堆叠。
- 只读播放器、真实播放头、选区统计与全文件 FFT/Welch、STFT。
- Win11 + macOS ARM64 真实 UI 自动化/截图验收及大于 1 GiB 文件的滚动与缩放性能验证。

### 设计约束

- 后端包络数组应以 `[start_frame,end_frame)` 时间区间或明确样本帧边界表示；前端不应猜测某个桶覆盖的精确采样段。
- 前端 UI 显示数据必须以 Rust DSP 测量为准，不重新发明 dBFS、Peak、RMS。
- 分析选区、页面导航与音频播放的时间坐标需从第一天统一用 i64/u64 帧号、UI 按采样率转换为秒。
- 保持 Windows 和 macOS 相同的画布可读性，暗色背景下峰值与零线应有充分对比度。
- 对齐 SPEC 2.0：移除音频转码/重新编码导出作为核心目标的计划，保留 CSV/JSON/PNG 等分析结果导出。现有 FFmpeg sidecar 继续用于**输入解码**。
