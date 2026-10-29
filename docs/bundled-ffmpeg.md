# FFmpeg 随包集成与许可证审计

> 目标：Windows x64 / macOS Apple Silicon / Intel 真正离线解码（无需用户额外安装 FFmpeg）。
> 版本：Audio Analyzer v0.2.0-alpha.1；FFmpeg 固定 **9.0.2**。
> 状态：代码与 CI 构建流程已接入；是否正式验收以对应 CI 产物及真实机器结果为准。

## 1. 方案和授权

采用 FFmpeg **独立可执行 sidecar**（ffmpeg 和 ffprobe），而不是将 libavcodec 直接静态链接到 Rust / Tauri 主程序。用户安装后通过应用内 FFmpeg 处理常见有损与无损音频，源文件始终只读。

- 只编译 FFmpeg 官方发行版源码：https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
- 源代码 SHA-256：`8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`。
- FFmpeg 构建参数禁用 `--enable-gpl`、`--enable-nonfree`、第三方自动探测库及网络协议；**不启用 GPL 专有编码器**。实际构建必须输出 `License: LGPL`，构建脚本有强制检查。
- 通过独立 `ffmpeg` 子进程实现编码/解码，不直接通过 Rust FFI 链接 FFmpeg shared/static libav 库。
- 每个 Windows / macOS 安装包包含所使用的 **FFmpeg 完整匹配源码 tarball、COPYING.LGPLv2.1、FFMPEG-LICENSE.md、BUILD-INFO.txt、SHA256SUMS.txt**，不只是链接到外部网站；这些文件位于应用资源 `licenses/ffmpeg/`。
- 建议网站下载页同时说明 FFmpeg 的 LGPL 授权及源码获取方式；商用分发/出口市场仍需专业法律复核，音频编解码专利不因 LGPL 自动消失。
- FFmpeg 官方法律指引：https://ffmpeg.org/legal.html

## 2. 一份源码构建三个平台

构建脚本：[scripts/build-ffmpeg-sidecar.sh](../scripts/build-ffmpeg-sidecar.sh)。

| 平台 | 编译环境 | 二进制名称 | 安装包 |
|---|---|---|---|
| Windows x64 | GitHub Windows runner + MSYS2 UCRT64 GCC | `ffmpeg-x86_64-pc-windows-msvc.exe` / `ffprobe-x86_64-pc-windows-msvc.exe` | NSIS `.exe` |
| Apple Silicon | macos-15 / Apple clang | `ffmpeg-aarch64-apple-darwin` / `ffprobe-aarch64-apple-darwin` | `.app` / `.dmg` |
| Intel Mac | macos-15-intel / Apple clang | `ffmpeg-x86_64-apple-darwin` / `ffprobe-x86_64-apple-darwin` | `.app` / `.dmg` |

> Windows 编译器采用 Mingw/UCRT，但 Tauri **sidecar 文件后缀必须按主应用的 Rust target triple 命名**（此项目使用 MSVC Rust target）。可执行文件仍为 Win64 PE。

运行时优先在应用可执行文件旁查找 `ffmpeg` 和 `ffprobe`（Tauri bundle.externalBin）；**release 模式不退回不受审核的系统 FFmpeg**。`cargo test` / Tauri debug 开发模式允许使用用户自己的 FFmpeg 作辅助测试。

## 3. CI 验证条件

- 编译源码后验证 FFmpeg 输出的许可声明是 LGPL，检查 buildconf 无 `--enable-gpl` 和 `--enable-nonfree`。
- 校验下载源码 SHA-256，与随包源代码、构建配置记录一致。
- Windows 与 macOS 都需要本机可执行 `ffmpeg -version` 和 `ffprobe -version`；不能引用系统预装 FFmpeg 冒充捆绑版。
- 打包后检查 **实际** `.app` / `.dmg` / NSIS EXE，并校验 macOS 包内二进制、对应源码、原有 `codesign --verify`、`hdiutil verify`。
- 应将 packaged FFmpeg 对八种格式进行 `probe → decode` 的测试与 Windows/macOS 安装后真正运行测试一并列入产品验收。
- 没有上述 CI 通过或真机测试时，不宣称已完成“免安装支持所有格式”。

## 4. 当前限制

1. 这次完成的是音频解码工具**随包构建和安装流程**；完整文件分析、时频谱及多码率音频导出仍分别属于 M1–M3。
2. 不使用任何 `--enable-gpl` 的外部 codec。标准 MP3、AAC、FLAC、Opus、Vorbis 等格式解码能力根据随包 FFmpeg 默认内建 codec 实测确认；MP3 高质量编码（例如 libmp3lame）未来需要额外做许可证与编码器集成。
3. 即使 CI 全绿，macOS 预览版仍采用 ad-hoc 签名，正式对外发布仍需要 Apple Developer ID 签名和公证。
4. 构建结果生成本机 FFmpeg 版本，可移植性需分别验证：Windows PE 不应依赖用户预装的 MSYS2 DLL；macOS Mach-O 不应依赖 Homebrew 动态库。
5. 许可证声明和匹配源码已纳入构建流程；最终上线前需要复核完整依赖和分发条款。

## 5. 本地构建

在 macOS（已安装 Xcode Command Line Tools / Node / Rust）：

```bash
npm install
npm run prepare:icons
bash scripts/generate-macos-icons.sh
bash scripts/build-ffmpeg-sidecar.sh "$(rustc --print host-tuple)"
npm run tauri build -- --bundles app,dmg
```

在 Windows：运行 GitHub Actions 的 `desktop-windows` 工作流，它会在 MSYS2 UCRT64 环境构建并随 NSIS 打包 FFmpeg；本地 MSYS2 构建目标为 `x86_64-pc-windows-msvc`，产物由 Tauri 识别。**不要直接提交下载来源不明的二进制文件。**
