<p align="center">
  <a href="README.zh-CN.md">简体中文</a> | <a href="README.md">English</a>
</p>

<div align="center">
  <h1>
    <img src="docs/Meetily-6.png" alt="Meetily" />
    <br />
    Meetily 中文定制版
  </h1>
  <p><strong>本地优先的 AI 会议录音、转写、逐字稿整理与总结工具</strong></p>
  <p>开源 · 中文优先 · 数据可控 · 模型可选</p>
</div>

> [!NOTE]
> 本仓库是 [Meetily](https://github.com/Zackriya-Solutions/meeting-minutes) 的社区定制分支，保留并感谢上游项目及贡献者的工作。本分支重点改进中文体验、本地语音识别、逐字稿处理和总结工作流，并非上游官方发行版。

## 这个版本是什么

Meetily 可以录制麦克风与系统音频，将会议内容转成逐字稿，再通过本地模型或用户配置的 AI 服务生成总结。

这个定制版以中文使用场景为主，解决了原版中文界面覆盖不足、录音与实时转写绑定、中文转写容易误走英语翻译、导入音频与设置模型不一致等问题，同时增加了 Qwen3-ASR、FunASR、逐字稿整理、单段重新转写和可编辑总结模板。

完整的实现差异、默认值、验证结果和已知限制见 [定制版完整变更说明](docs/CUSTOM_CHANGES_ZH.md)。

## 主要功能

- **中文优先界面**：支持简体中文和英文，默认使用简体中文，主要录音、转写、模型和总结界面均已汉化。
- **录音与转写分离**：可以边录音边实时转写，也可以只保存录音、稍后再转写。
- **保留原语言**：默认自动识别并保留语音原语言；Whisper 的“翻译为英语”是单独选项，不再与自动检测混用。
- **统一模型选择**：实时录音、导入音频、整场重新转写和单段重新转写使用一致的模型与语言设置。
- **本地 Qwen3-ASR**：在 Apple Silicon Mac 上由 Meetily 自动管理 MLX-Audio 隔离运行时，使用时启动，结束后停止。
- **FunASR 支持**：支持 Apple Silicon Mac 本地 SenseVoice，也支持用户自行部署的 OpenAI 兼容 FunASR 服务。
- **复用已有模型**：可引用其他软件已经下载的兼容模型目录，避免重复占用磁盘空间。
- **逐字稿 AI 整理**：清理口头语、重复和不通顺表达，但保留原意；原始稿与整理稿分开保存并可随时切换。
- **局部重新识别**：可只对某一段对应的录音时间范围重新转写，不必处理整场录音。
- **更实用的总结**：内置内容总结、会议纪要和项目同步模板，支持精简、标准、详细三种密度。
- **模板可编辑**：内置模板可查看、修改和恢复默认，也可以创建自己的总结模板。
- **Markdown 表格**：总结中的普通 Markdown 表格可以直接渲染，不要求返回 Mermaid 或图片。
- **灵活的总结模型**：支持本地模型以及自定义 OpenAI 兼容服务，可选择 Responses API 或 Chat Completions API。

## 转写模型

| 模型或服务 | 运行方式 | 平台说明 | 适合场景 |
| --- | --- | --- | --- |
| Whisper | Meetily 内置本地运行 | macOS、Windows、Linux | 多语言、指定语言、可选翻译为英语 |
| Parakeet | Meetily 内置本地运行 | 取决于上游平台支持 | 英语等支持范围内的快速转写 |
| Qwen3-ASR | Meetily 自动管理 MLX-Audio | 目前仅 Apple Silicon Mac | 中文、粤语及多语言本地识别 |
| FunASR / SenseVoice | Meetily 本地运行 | 目前仅 Apple Silicon Mac | 自动语言检测、本地快速识别 |
| 外部 FunASR | 用户提供兼容服务地址 | 客户端平台不限 | 使用已有服务器或其他机器上的模型 |

> [!IMPORTANT]
> “本地优先”不等于所有配置都会离线运行。选择外部 FunASR 或外部总结服务时，相应音频或文字会发送到你配置的服务。是否保存、如何处理数据取决于该服务本身，请在处理敏感会议前确认其隐私策略。

## 推荐使用流程

1. 首次启动时选择是否立即下载模型；也可以跳过，稍后在设置中下载。
2. 在“设置 → 转写”中选择 provider、模型和默认语言。
3. 按需要分别开启“保存录音”和“实时转写”，两者至少开启一项。
4. 录音结束后检查逐字稿；识别错误的段落可以单独重新转写。
5. 如需更易读的完整记录，使用“AI 整理逐字稿”；原始识别文本不会被覆盖。
6. 选择总结模板和详细程度，再使用本地模型或自定义服务生成总结。

## 模型下载与复用

模型设置页会展示下载状态。你可以：

- 首次设置时跳过模型下载；
- 之后按需下载；
- 删除 Meetily 自己下载的模型；
- 引用其他软件已有的兼容模型目录。

引用已有目录时，Meetily 不会复制完整模型。删除这个引用也不会删除原始模型文件。目录结构和文件仍须符合对应运行时的要求，名称相同并不代表模型格式一定兼容。

## 总结与自定义服务

总结可使用内置本地模型，也可以连接自定义 OpenAI 兼容服务。自定义服务支持：

- OpenAI Responses API；
- Chat Completions API；
- 自定义基础地址和模型名；
- 思考强度；
- 输出详细程度；
- 是否保存响应等兼容配置。

不同中转服务对路径的要求可能不同。例如基础地址可能以 `/v1` 或 `/codex/v1` 结尾。Meetily 会按所选 API 类型补全请求端点，但服务端仍必须实际提供对应模型和路由。

## 安装

本分支目前没有在仓库中提交 App 或 DMG 等构建产物。已有本地打包文件也不会进入 Git，因为它们属于可重新生成的产物。

如果后续发布 GitHub Release，可直接下载对应平台的安装包。当前可按下面的方式从源码构建。

## 从源码构建

基础依赖：

- Git
- Rust 工具链
- Node.js 与 pnpm
- macOS 构建还需要完整安装并初始化 Xcode

```bash
git clone git@github.com:yc1640/meetily.git
cd meetily
cd frontend
pnpm install
./build-gpu.sh
```

构建脚本也可以从仓库根目录调用：

```bash
cd meetily
./frontend/build-gpu.sh
```

macOS 首次使用 Xcode 命令行组件时，如果遇到插件或首次启动错误，可运行：

```bash
sudo xcodebuild -runFirstLaunch
```

详细依赖和其他平台说明见 [从源码构建](docs/BUILDING.md)。

### macOS 构建产物

默认可以在以下目录找到：

```text
target/release/bundle/macos/meetily.app
target/release/bundle/dmg/meetily_0.4.0_aarch64.dmg
```

当前定制版关闭了 Tauri 更新器制品的强制生成，因此本地构建 App/DMG 不需要更新签名私钥。正式发布自动更新版本时，仍需单独配置签名和发布流程。

## 当前限制

- Qwen3-ASR 的 Meetily 托管本地模式仅支持 Apple Silicon Mac。
- FunASR 本地模式目前使用 SenseVoice GGUF，也仅支持 Apple Silicon Mac。
- Windows 可继续使用 Whisper、Parakeet 或外部服务，但不能直接使用 MLX-Audio 本地路径。
- SenseVoice 本地模式使用自动语言检测，不提供手动语言提示。
- 单段重新转写要求会议保留原录音，并且该段具有有效的开始和结束时间。
- 修改逐字稿后不会自动覆盖已有总结，需要用户确认后重新生成。
- 自定义兼容服务的能力取决于服务端是否实现所选 API、模型和参数。

## 文档

- [定制版完整变更说明](docs/CUSTOM_CHANGES_ZH.md)
- [从源码构建](docs/BUILDING.md)
- [系统架构](docs/architecture.md)
- [上游英文介绍](README.md)

## 上游项目与贡献

本项目基于 Meetily Community Edition：

- 上游仓库：[Zackriya-Solutions/meeting-minutes](https://github.com/Zackriya-Solutions/meeting-minutes)
- 上游网站：[meetily.ai](https://meetily.ai)

如需提交本定制分支的问题，请在当前仓库创建 Issue；上游原版问题和通用贡献请优先遵循上游仓库的贡献说明。

## 许可证

本项目沿用 MIT License。第三方模型、运行时和外部服务可能有各自的许可证与使用条款，使用前请分别确认。
