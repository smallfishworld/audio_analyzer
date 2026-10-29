# macOS 支持与 M0/M1 验证说明

> 更新：2026-10-29  
> 目标版本：Audio Analyzer v0.2.0-alpha.1 (M1 Preview)  
> 状态：跨平台 CI 验证中；不代表已完成 Apple 签名/公证和 macOS 真机 UX 验收。

## 1. 目标架构

| 架构 | CI runner | Rust target | 交付格式 | 优先级 |
|---|---|---|---|---|
| Apple Silicon（M1～M 系列） | macos-15 (ARM64) | aarch64-apple-darwin | .app + .dmg | P0 |
| Intel Mac | macos-15-intel (x86_64) | x86_64-apple-darwin | .app + .dmg | P0 |

macOS 使用 WKWebView，复用 Windows 的 React 界面、Rust FFT/dBFS 与文件解析内核。默认目标最低 macOS 11.0，但 CI 使用 macOS 15 构建；**最低系统版本属于待真机验证的兼容性目标**。不支持 PPC 或 32 位系统。

## 2. 与 Windows 的平台分离

- src-tauri/tauri.conf.json 保留 Windows NSIS 的默认配置，不修改其产物。
- src-tauri/tauri.macos.conf.json 自动按平台合并，覆盖 macOS .app/.dmg 打包和 .icns 图标。
- scripts/generate-icons.mjs 可复现生成 1024px 原图与 Windows .ico。
- scripts/generate-macos-icons.sh 使用 macOS 原生 sips/iconutil 生成 Retina 图标。
- Rust 解析与 DSP 保持共用，不复制另一套 macOS 计算算法。
- macOS GUI 双击启动通常不继承 Shell 的 Homebrew PATH：ffprobe/ffmpeg 在 macOS 优先按相邻受审计打包文件、/opt/homebrew/bin、/usr/local/bin、/opt/local/bin 寻找，然后才回退 PATH。

## 3. 构建方法

在 Apple Silicon Mac（需要 Xcode Command Line Tools、Node.js 22、Rust stable、Tauri 2 构建依赖）：

```bash
npm install
npm run prepare:icons
bash scripts/generate-macos-icons.sh
npm run tauri dev
npm run tauri build -- --bundles app,dmg
```

运行内核测试：

```bash
cargo test --manifest-path crates/audio-core/Cargo.toml
```

GitHub Actions: [.github/workflows/macos.yml](../.github/workflows/macos.yml)。PR 和 main push 均触发 ARM64/Intel 原生构建，检查 cargo、前端、生成应用图标、codesign --verify、hdiutil verify；通过后上传两份独立 DMG Artifact。

## 4. Apple 签名与公证

目前使用 `bundle.macOS.signingIdentity = "-"` 进行**Ad-hoc（本地临时身份）签名**。这不等于 Apple Developer ID 签名，更不等于 Apple notarization（公证）。

- 对外正式发布：需要有效 Apple Developer Program 证书，并按 Apple/Tauri 要求完成 Developer ID 签名、Hardened Runtime、公证和 stapling 验证。
- 在此之前应把 DMG 标记为 **测试/预览版，未公证**。macOS Gatekeeper 可能阻止普通双击启动，不得宣称已通过官方可信分发流程。
- 不在源码或 CI 日志中明文添加 Apple ID、Team ID、证书私钥或 API key；接入 GitHub Actions Secrets 后另设签名发布工作流。
- CI 可以确认 App Bundle、架构、Ad-hoc 签名和 DMG 镜像完整性，但无法代替用户实际安装、打开文件和关闭应用的 GUI 验收。

## 5. 文件兼容性

- WAV / 无头 PCM 的分析不依赖 FFmpeg。
- MP3、AAC、FLAC、AIFF、M4A、OGG、Opus：现阶段需要 FFmpeg + ffprobe 已在 macOS 安装；例如开发机可手动 `brew install ffmpeg`。
- 当前 alpha 安装包**未将 FFmpeg/ffprobe 合规随包分发**。多格式自动分析是否工作，取决于本机实际 FFmpeg 构建和安装位置。
- 音频分析仍为每次选择一个通道、最多前三秒/576000 帧的预览；整文件分块分析与时频谱属于后续里程碑。

## 6. macOS 验收清单

- [ ] ARM64 runner 的 cargo check、.app、.dmg 构建成功，产物为 arm64 Mach-O。
- [ ] Intel runner 的 cargo check、.app、.dmg 构建成功，产物为 x86_64 Mach-O。
- [ ] `codesign --verify --deep --strict` 和 `hdiutil verify` 通过。
- [ ] Apple Silicon 真机启动，打开 RAW PCM/WAV、切声道、查看 dBFS 和 FFT。
- [ ] Intel Mac 真机启动，检查同样的功能（如能获取设备）。
- [ ] macOS 15、未来版及最低系统版本兼容性验证。
- [ ] Finder 双击启动后 FFmpeg 路径检查、错误消息、异常文件、安全退出。
- [ ] 完成 Developer ID 签名、公证和带认证发行流程（正式 Release 阶段）。
- [ ] 按照开源许可证核验，完成 FFmpeg sidecar 及真实离线多格式导入（M1 完成门槛）。

通过 GitHub CI 后可将前 3 条更新为通过；其余验收未实际执行前保持未完成。
