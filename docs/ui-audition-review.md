# Audio Analyzer UI Review：向 Audition 的分析工作区靠齐

> 2026-10-30 | PR #11 | 仅借鉴公开的工作区布局与操作逻辑，不复制 Adobe 商业界面素材，也不引入剪辑、混音、效果器。

## 1. 对照依据

Adobe Audition 的公开官方指南展示了文件列表、Waveform Editor、Zoom Navigator、Transport、Frequency Analysis、Selection/View、Amplitude Statistics、Properties 等彼此协同的面板和快捷键：

- [Adobe：界面/面板概览](https://www.adobe.com/learn/audition/web/audition-interface-tour-multitrack-cc)
- [Adobe：显示、缩放、音频导航](https://helpx.adobe.com/nz/audition/desktop/workspace-and-setup/viewing-zooming-navigating-audio.html)
- [Adobe：默认快捷键](https://helpx.adobe.com/audition/desktop/keyboard-shortcuts/default-keyboard-shortcuts.html)
- [Adobe：工作区自定义](https://helpx-origin.aws116.adobeitc.com/ie/audition/desktop/workspace-and-setup/customizing-workspaces.html)

Audio Analyzer 应复用**分析心智模型**（先打开文件、再定位时间、再分析），不照搬编辑功能和品牌视觉。

## 2. 本次直接修复的 UI 问题

| 审查问题 | 代码现状（改动前） | 本次改动 | 验收 |
|---|---|---|---|
| 过度仪表盘化 | 大幅宣传 Hero/四张指标卡，波形不聚焦 | 47px 工具栏 + 中央波形 + 右侧分析 Dock | UI 自动检查布局与画布 |
| 文件列表不可用 | 侧栏仅 Open/Demo，无法快速重开文件 | 左侧真实可点击的本次会话最近文件列表，支持重复打开 | 通过 mock 文件打开测试 |
| 缺少全文件缩略导航 | 仅主波形和缩放按钮 | 概览 Canvas、视口矩形、拖动/点击导航、键盘左右移动 | 浏览器检查视口宽度变化 |
| 时间操作分散 | 仅底部文字读数 | Cursor、Selection In/Out/Duration，导航操作区 | 浏览器选区/键盘测试 |
| 频谱与测量混排 | FFT 和指标卡纵向抢主波形视野 | 右侧 Spectrum/Amplitude Statistics/Properties Dock，可隐藏 | 浏览器 Dock 检查 |
| 无整体操作快捷键 | 每次必须点击波形按钮 | Ctrl/Cmd+O、Home/End、+/-、Esc | 浏览器键盘测试 |
| Demo 并发覆盖文件 | 初始化 demo 未在选择文件时立即失效 | 切换文件时首先增加世代号，过期结果不提交 UI | 代码行为约束 |
| 废弃绘图库分支 | 同一 Chart 仍包含未使用的波形 min/max 线图 | 拆为只负责 FFT 的 SpectrumPanel | 前端编译与图表可见测试 |

## 3. 本次真正实现

- Files：会话内最近打开文件，可重复点击加载；重新打开 RAW PCM 复用已确认的格式参数。
- Editor：全时段 min/max Canvas 波形、时间标尺、低分辨率概览导航、选择与缩放、选区时间精确输入。
- Navigator：拖动概览视口、鼠标滚轮以指针为中心缩放、Zoom In/Out、Zoom to Selection、Fit Full、Home/End。
- Analyze：使用光标位置设置 FFT 窗起始时间，按按钮执行后端分析；频谱与全文件 Peak/RMS 明确区分统计窗口。
- Inspector：Frequency Analysis、Amplitude Statistics 和文件属性；可开关侧面板，不出现无效“播放”按钮。
- 图表：frequency 单位 kHz / amplitude dBFS；用户可以选择声道并重新计算。

## 4. 仍不应宣称已经与 Audition 功能相当

1. 无真正音频播放（只读试听）与跟随播放头；因此**不放假 Play 按钮**，只是将导航操作放在类似 Transport 的下方区域。
2. 无精细多级 LOD；当前只使用 Rust 已返回的约 1200 个包络桶。超过可用分辨率时缩放受限，不能把近似数据当样本级波形。
3. 无实时联动的 spectrogram/STFT、选区 Peak/RMS 及频段面积统计，暂不能支持所有专业检测工作流。
4. Files 列表仅当前会话，不是跨启动历史库；没有多标签编辑器并行打开多个实例、面板拖拽/用户布局保存。
5. GUI 测试是 **Playwright + 模拟 Tauri IPC 的 Chromium 浏览器测试**，不是 Windows WebView2/macOS WKWebView 原生截图与真实音频输入验收。
6. 只有现有完整 PCM/WAV 流式扫描与部分压缩格式预览；不能把压缩格式标为全文件分析。

## 5. 验证和下一阶段

CI `frontend-ui` 将安装 Chromium，运行 `tests/ui/workspace.spec.ts`，验证 1440×900 的 Dock 位置、基本缩放/快捷键、选区、文件切换、声道选择；上传 UI 截图和失败 trace。正式发布前还需对 Windows 和 Mac 做实际安装/鼠标/DPI/缩放的人工检查，并比较截图与视觉验收清单。

**下一优先级**：全文件多级 LOD 与局部高分辨率波形 > 只读试听和精确播放头 > 选区振幅/频谱分析 > Spectrogram > 布局保存与多文件切换优化。

源代码只读打开音频文件。选区、时间光标和文件列表不含任何音频编辑动作。
