# Meetily 定制版完整变更说明

## 1. 文档目的

本文记录当前工作区相对上游初始版本的全部定制修改，供后续开发、测试、打包、合并上游和问题排查使用。

- 项目目录：`/Users/yc/life/meetily`
- 对比基线：`0281737d87d26352fb0adc78c8c0975f691b23d1`
- 基线说明：`Merge pull request #502 from Zackriya-Solutions/meetily/release/v0.4.0`
- 基线日期：2026-06-05
- 盘点日期：2026-09-03
- 盘点范围：102 个已跟踪修改文件、4 个已删除模板文件、14 个新增实现文件，共 120 个实现差异文件
- 当前状态：修改尚未提交；本文档本身不计入上述 120 个实现文件

本文只描述仓库中已经实现的行为。尚未完成、受平台限制或尚未实际联调的内容会明确标注，不把计划中的能力写成已完成。

## 2. 变更总览

| 模块 | 主要变化 |
| --- | --- |
| 界面语言 | 新增英文和简体中文界面，默认简体中文，并汉化主要使用流程 |
| 录音 | 保存录音与实时转写拆分为独立开关，支持只录音不转写 |
| 转写语言 | 默认保留原语言；Whisper 的自动检测与翻译为英语明确分离 |
| 转写架构 | 录音、导入音频和重新转写共用 provider/model 配置与转写入口 |
| Qwen3-ASR | Apple Silicon Mac 上由 Meetily 自动管理 MLX-Audio 本地运行时和服务 |
| FunASR | 增加 Apple Silicon Mac 本地 SenseVoice 模式，以及外部 OpenAI 兼容服务模式 |
| 模型管理 | 展示下载状态，支持稍后下载，并可引用已有模型而不重复复制 |
| 导入与重新转写 | 模型选项与设置页统一；既可重新处理整场录音，也可点击单段只重新识别对应时间范围 |
| 逐字稿整理 | 使用当前总结模型清理口头语、重复与病句；原文和整理稿分开保存，可切换或撤销 |
| 总结模型 | 修复本地模型选择总被重置为第一个模型的问题 |
| 总结模板 | 精简为 3 个通用内置模板；可查看、修改、恢复默认，并可新建、编辑和删除自定义模板 |
| 总结质量 | 增加精简/标准/详细三级信息密度，强化分段提取、合并与最终报告提示词 |
| 总结展示 | 支持直接渲染普通 Markdown 表格；只在同类记录更适合比较时要求模型使用表格 |
| 自定义总结服务 | 支持 Responses API 和 Chat Completions，改用思考强度与详细程度配置 |
| 数据兼容 | 增加转写 endpoint/API Key 存储并兼容旧模型名称和旧配置 |
| 构建 | 修复 GPU 构建脚本的工作目录问题，关闭更新器制品的强制生成 |

## 3. 界面语言与中文支持

### 3.1 语言能力

新增应用级语言上下文，支持：

- 简体中文：`zh-CN`
- 英文：`en`

默认语言为简体中文。用户选择保存在浏览器本地存储的 `meetily.appLanguage` 中，重新启动后继续使用上次选择；同时同步更新页面根节点的 `lang` 属性。

设置页新增“界面语言”选项。模型名、产品名和技术名词，例如 Qwen、FunASR、Whisper、Parakeet、Ollama、GGUF，不为了汉化而硬译。

### 3.2 已覆盖的主要界面

中文覆盖范围包括：

- 首页、侧边栏和设置入口
- 设置页和设置弹窗
- 录音控制、录音状态和设备选择
- 转写模型、语言选择和录音偏好
- Whisper、Parakeet、Qwen3-ASR、FunASR、本地总结模型管理
- 导入音频和拖放提示
- 会议详情、重新转写、逐字稿和总结操作
- 三个内置总结模板的名称、说明、总体提示词、章节要求和表头；用户已保存的自定义内容保持原样
- 初始设置、权限申请、下载进度、错误和重试
- 恢复未完成会议和确认弹窗
- 分析数据说明、Beta 设置和权限警告

界面文本采用组件内双语文案与应用语言上下文组合的方式实现，目前没有引入独立 i18n 依赖或远程翻译服务。

## 4. 录音与实时转写解耦

### 4.1 新增录音偏好

录音偏好增加两个独立字段：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `auto_save` | `true` | 是否保存录音文件 |
| `transcription_enabled` | `true` | 是否在录音期间实时转写 |
| `file_format` | `mp4` | 保存录音时使用的文件格式 |

用户现在可以：

- 同时保存录音并实时转写；
- 只保存录音，不启动实时转写；
- 不保存录音，只保留实时转写结果。

为避免一次录音没有任何产物，界面和后端都要求 `auto_save` 与 `transcription_enabled` 至少开启一个。录音开始后相关设置会锁定，避免运行中改变管线结构。

### 4.2 只录音模式的后端行为

当 `transcription_enabled = false` 时：

- 不验证转写模型是否已下载；
- 不初始化转写引擎；
- 不创建 VAD 和转写 channel；
- 不启动转写任务；
- 停止录音时不等待转写任务，也不执行无关的模型清理；
- 音频仍按保存设置写入录音文件。

`recording-started` 事件、`get_recording_state` 命令和前端录音状态都增加了 `transcription_enabled`，因此恢复界面和状态栏能够区分“正在录音并转写”与“只录音”。

## 5. 转写语言行为修正

### 5.1 默认行为

Rust 和前端配置中的默认语言由 `auto-translate` 改为 `auto`：

- `auto`：自动检测语音语言，保留原语言输出；
- `auto-translate`：仅对 Whisper 明确启用“翻译为英语”；
- 具体语言代码：向支持语言提示的 provider 传递用户指定语言。

这避免用户选择中文或自动检测时，被默认翻译为英语后再参与后续处理。Whisper 调用中，语言提示和 `translate` 标志现在分别设置，不再把两种行为混为一体。

语言列表新增粤语 `yue`。语言显示名使用 `Intl.DisplayNames`，会随界面语言显示中文或英文名称。

### 5.2 不同 provider 的语言能力

| Provider | 可选语言 | 翻译为英语 |
| --- | --- | --- |
| Whisper | 自动检测、具体语言、粤语 | 支持，作为单独选项显示 |
| Parakeet | 界面仍保留自动检测/翻译选项 | 当前实际路径按自动检测处理，不应视为真正翻译能力 |
| Qwen3-ASR 本地 | `auto/zh/yue/en/de/es/fr/it/pt/ru/ko/ja` | 不支持，界面隐藏 |
| FunASR 本地 SenseVoice | 只显示自动检测 | 不支持，界面隐藏 |
| 外部 FunASR | 自动检测或具体语言 | 不支持，界面隐藏 |

Qwen3-ASR 请求会把 Meetily 使用的 ISO 语言代码转换为 Qwen 支持的语言名称；无法映射时回退为自动检测。SenseVoice 本地模式会忽略手动语言偏好并自动检测，这是当前 runtime 的明确限制。

## 6. 转写 provider 统一与导入音频

### 6.1 Provider 类型

当前统一支持以下转写 provider：

| Provider ID | 用途 |
| --- | --- |
| `localWhisper` | 内置 Whisper 本地模型 |
| `parakeet` | Parakeet 本地模型 |
| `qwen3Asr` | Meetily 托管的 Qwen3-ASR + MLX-Audio 本地服务 |
| `funasrLocal` | Meetily 直接运行的本地 SenseVoice GGUF |
| `funasr` | 用户自行部署的 OpenAI 兼容 FunASR 服务 |

转写引擎新增 provider 分派层。实时录音、导入音频和重新转写复用同一套 provider/model 配置和音频准备逻辑，减少三条路径各自实现后产生的选项不一致。

### 6.2 导入音频与重新转写

导入音频和重新转写对话框现在：

- 展示与设置页一致的 provider 和模型；
- 默认选中设置中保存的 provider/model；
- 不再无条件选择列表中的第一个模型；
- 能展示保存的外部 FunASR 服务模型；
- 如果保存的本地模型尚未下载，保留该选择并显示明确错误，而不是悄悄切换模型；
- 使用统一的批处理转写入口。

因此，用户在设置中选择 FunASR、Qwen3-ASR 或其他模型后，导入音频默认会沿用同一选择。

### 6.3 单段重新转写

会议详情中，带有有效开始和结束时间的逐字稿段落可以直接点击重新转写图标。弹窗会显示该段对应的录音时间范围，并继续复用设置页和整体重新转写所使用的模型、语言选项。

单段模式具有以下行为：

- 使用随应用提供的 FFmpeg，只从原录音截取该段时间范围，不重新解码或处理整场会议；
- 截取的音频统一转换为 16 kHz 单声道 WAV，再交给选中的 Whisper、Parakeet、Qwen3-ASR 或 FunASR 路径；
- 识别成功后只替换该段的原始 ASR 文本，其他段落和时间轴不变；
- 如果该段存在 AI 整理稿，会同时清除这一段的整理稿，避免继续显示基于旧原文生成的内容；
- 更新数据库后同步重写会议目录中的原始 `transcripts.json`，使导出的原始转写与数据库一致；
- 不自动重新生成已有总结，用户可以在确认新转写后手动重新生成；
- 保存时检查该段原文是否在处理期间发生变化，若已变化则拒绝旧结果，避免并发覆盖；
- 单段与整场重新转写共用互斥和取消状态，不允许两个语音识别替换任务同时写入。

没有录音文件、缺少有效时间范围的旧段落，或尚未准备好转写模型时，不会执行单段重新转写。模型没有识别出文字或处理失败时会保留原文。

## 7. Qwen3-ASR 本地运行

### 7.1 适用平台

Meetily 托管的 Qwen3-ASR 本地模式当前仅支持：

```text
Apple Silicon Mac（macOS arm64）
```

Windows 和 Intel Mac 当前不能使用这条 MLX-Audio 本地路径。外部服务模式并不能自动消除服务端本身的平台要求。

### 7.2 自动管理的运行时

用户不需要手动执行 `pip install mlx-audio`，也不需要在终端中长期运行服务。Meetily 会管理一个隔离运行时：

| 组件 | 固定版本 |
| --- | --- |
| uv | `0.11.24` |
| Python | `3.12` |
| MLX-Audio | `0.5.1` |
| Python 安装项 | `mlx-audio[stt,server]` |

主要流程：

1. 下载 uv 和模型所需文件；
2. 创建独立 Python 虚拟环境；
3. 在隔离环境中安装 MLX-Audio；
4. 用户开始转写时，Meetily 在 `127.0.0.1` 的随机端口启动本地服务；
5. 通过 `/models?model_name=...` 预加载选中模型；
6. 通过 `/v1/audio/transcriptions` 发送转写请求；
7. 转写完成、停止录音或应用退出时停止服务并释放模型内存。

服务作为 Meetily 子进程运行，并带父进程 watchdog。Meetily 异常退出时，子服务也会结束，避免后台长期残留。运行时、模型下载和服务启动状态通过 Tauri 事件传给界面。

### 7.3 支持的模型

| 模型 | 约占空间 |
| --- | ---: |
| `mlx-community/Qwen3-ASR-0.6B-8bit` | 959.6 MiB |
| `mlx-community/Qwen3-ASR-1.7B-8bit` | 2.29 GiB |

默认存储目录：

```text
<app_data_dir>/models/qwen3-asr/
```

请求音频统一转换为 16 kHz、单声道、16-bit PCM WAV，并使用 `response_format=json`。

### 7.4 使用已有模型

模型管理页可以选择已有的 MLX Qwen3-ASR 模型目录。Meetily 只创建文件系统引用，不复制完整模型，因此可以和其他软件共用同一份模型数据。

删除外部模型时只删除 Meetily 创建的引用，不删除原始模型目录。

## 8. FunASR 支持

FunASR 分为两种调用方式，二者不能混为一谈。

### 8.1 Meetily 本地模式：`funasrLocal`

当前本地模式使用 SenseVoiceSmall GGUF，仅支持 Apple Silicon Mac：

| 项目 | 值 |
| --- | --- |
| 模型 ID | `sensevoice-small-q8` |
| 模型文件 | `sensevoice-small-q8.gguf` |
| Runtime | FunASR llamacpp `0.2.0` |
| Runtime 大小 | 约 7 MiB |
| 模型大小 | 约 242 MiB |
| Backend | CPU |

Runtime 从 ModelScope 的 FunASR release 下载，模型来自 Hugging Face 的 `FunAudioLLM/SenseVoiceSmall-GGUF`。默认存储目录为：

```text
<app_data_dir>/models/funasr/
```

Meetily 会校验文件大小、GGUF magic 和 SHA-256。每次批处理转写时启动本地 binary，转写结束后进程退出；这条路径不依赖 Python、Docker，也不需要用户手动启动服务。

SenseVoice 当前自动检测语种，不提供“翻译为英语”，手动语言偏好不会传给本地 runtime。

用户也可以导入已有 `.gguf` 文件。导入只创建引用，不复制源文件。

### 8.2 外部服务模式：`funasr`

外部 FunASR 模式用于连接用户自行部署的 OpenAI 兼容 ASR 服务：

- 用户填写 endpoint、model 和可选 API Key；
- Meetily 不下载模型、不启动服务、不管理服务进程；
- 请求采用 multipart WAV；
- endpoint 可以填写基础 URL，例如 `http://127.0.0.1:8000/v1`；
- Meetily 会请求 `http://127.0.0.1:8000/v1/audio/transcriptions`；
- API Key 为空时不发送 `Authorization` 请求头；
- 保存的外部 model 会出现在导入音频和重新转写列表中。

外部模式没有本地“模型目录”可添加，因为模型文件位于外部服务端，而不是 Meetily 进程内。

## 9. 已有模型引用与完整性校验

### 9.1 通用引用策略

新增通用模型引用模块，允许 Meetily 使用其他软件已经下载的模型，避免重复占用磁盘：

- Unix/macOS：使用符号链接；
- Windows 目录：使用目录符号链接；
- Windows 文件：使用硬链接，因此源文件和 Meetily 模型目录必须位于同一磁盘；
- 发现断开的旧引用时允许替换；
- 删除外部模型只删除引用，不递归删除源文件或源目录。

引用策略已用于：

- Whisper 模型；
- Parakeet 模型；
- 内置总结 GGUF 模型；
- Qwen3-ASR MLX 模型目录；
- FunASR 本地 GGUF 模型。

### 9.2 Whisper

Whisper 模型管理增强包括：

- 使用官方模型的精确字节数判断下载是否完整；
- 检查 GGML/GGUF 文件头，不再只依赖大致 MB 数；
- 模型信息增加 `is_external`；
- 支持选择已有 `.bin` 模型文件；
- 根据精确文件大小和文件头识别受支持模型；
- 添加后刷新并选中该模型，不复制文件。

### 9.3 Parakeet

Parakeet 模型管理增强包括：

- 模型信息增加 `is_external`；
- 支持选择已有 Parakeet Int8 ONNX 模型目录；
- 检查 `encoder-model.int8.onnx`、`decoder_joint-model.int8.onnx`、`nemo128.onnx` 和 `vocab.txt`；
- 根据 decoder/vocab 大小推断 v2 或 v3；
- 删除外部模型时仅删除链接目录；
- 下载和模型状态界面标记“外部文件”。

### 9.4 内置总结模型

总结模型管理支持添加已有 GGUF 文件。当前识别仍依赖受支持的官方文件名，因此导入时需要保留原文件名。界面能区分未下载、下载中、可用、损坏、外部文件和错误状态。

## 10. 初始设置与下载策略

初始设置不再强制立即下载模型。设置概览会显示准备下载的具体模型：

- 转写模型：`parakeet-tdt-0.6b-v3-int8`；
- 总结模型：根据当前机器配置推荐的内置模型。

每个模型都有独立开关，用户可以选择“立即下载”或“稍后设置”，也可以同时跳过两项。两个下载开关默认开启，但可以关闭。

跳过后仍可进入应用，之后在设置中下载模型或添加已有模型。下载进度、后台继续下载、失败和重试状态已汉化；初始设置会保存真实下载状态，不再无条件标记为已下载。

## 11. AI 整理逐字稿

会议详情的逐字稿工具栏新增“整理逐字稿”，它与“重新转写”和“生成总结”是三个不同的操作：

- 重新转写：重新处理录音文件，替换语音识别结果；
- 整理逐字稿：只编辑已有逐字稿的文字表达；
- 生成总结：从逐字稿中提炼结构化信息。

整理功能复用当前“总结模型配置”，支持已有的内置 GGUF、Ollama、OpenAI、Claude、Groq、OpenRouter 和自定义 OpenAI 兼容服务，不增加另一套模型设置。

AI 被明确约束为逐字稿编辑者，而不是总结者：

- 删除无意义语气词、说话中途放弃的开头和明显的紧邻重复；
- 修正标点、断句、语法和确定无疑的语音识别错误；
- 保留姓名、数字、日期、否定、条件、犹豫、分歧、举例和其他实质细节；
- 保持原语言，不翻译，不补充事实，不把内容改写成要点；
- 不合并、拆分、遗漏或重排任何转写段落。

长会议会按字符数和段落数分批调用模型。每一批要求返回带原始段落 ID 的 JSON，后端校验输出数量、ID 集合、重复 ID、未知 ID 和空内容，并恢复为原有顺序。结构不合格时自动纠正重试一次；任意一批最终失败时只返回错误，不保存部分结果。

生成成功后会打开对照预览，只展示真正发生变化的段落，并保留原时间文本。用户点击“保存整理稿”后才写入数据库；保存使用单个事务，同时检查：

- 预览包含会议当前的全部段落；
- 每个段落 ID 仍然存在；
- 原文字段自生成预览后没有变化；
- 预览生成时已有的整理稿没有被其他操作更新或撤销；
- 非空原文不会被替换成空内容。

原文与整理稿采用以下规则：

- 原始 ASR 文本继续保存在 `transcripts.transcript`，不会被整理功能覆盖；
- 会议目录中的 `transcripts.json` 继续作为原始转写文件，不因 AI 整理而改写；
- 整理稿单独保存在 `transcripts.polished_transcript`；
- 会议详情默认展示整理稿，可以随时切换“原文 / 整理后”；
- “撤销整理”只删除整理稿并恢复使用原文，不删除原文或录音；
- 重新整理始终以原文为输入，避免连续加工造成语义漂移；
- 复制逐字稿和新生成/重新生成总结时优先使用整理稿，没有整理稿时自动回退原文；
- 切换页面中的查看版本只影响显示，不改变复制与总结的数据源规则。

任一保存检查失败都会回滚全部修改，避免旧预览覆盖后续编辑。生成过程中可以取消当前模型请求。保存或撤销整理稿后不会自动重新生成已有总结，避免未经确认地覆盖用户的总结编辑。

## 12. 总结本地模型选择修复

修复了“总结”页面本地模型无法切换、总是回到列表第一个的问题。

根因是模型设置弹窗无条件使用全局 `ConfigContext` 的模型状态覆盖调用方正在编辑的草稿。现在弹窗使用调用方传入的 `modelConfig` 与 `setModelConfig`，只继续从 Context 读取和管理 API Key。

结果：

- 本地总结模型选择可以正常保持；
- 打开和关闭弹窗不会自动重置成第一个模型；
- 调用方可以在确认后统一保存草稿配置；
- 已有 GGUF 模型也可加入本地总结模型列表。

### 12.1 总结模板管理

模板按钮不再只是一个简单名称列表。下拉菜单会同时显示模板名称与用途，并显示当前正在使用的模板；“管理模板”进入完整编辑界面。

模板管理器支持：

- 查看模板名称、使用说明、总体 AI 要求和所有章节提取要求；
- 修改内置模板并保存为当前设备上的本地覆盖；
- 对修改过的内置模板执行“恢复默认”，不改动应用自带资源；
- 新建自定义模板；
- 修改章节标题、提取要求和输出格式；
- 设置章节为段落、列表/表格或单项内容；
- 为列表章节配置可选 Markdown 表格格式；
- 添加、删除、上移和下移章节；
- 删除自定义模板；
- 保存后直接选择该模板用于总结。

模板定义新增可选 `prompt` 字段，用于描述整个模板的目标、内容优先级、语气和禁止事项。每一章原有的 `instruction` 继续负责具体提取要求，因此用户可以看到并控制过去隐藏在 JSON 文件中的实际模板提示词。

用户模板存放在 Meetily 原有的本地自定义模板目录。内置模板的修改同样以覆盖文件保存；总结缓存指纹包含渲染后的模板和章节指令，所以修改模板后不会错误复用旧总结。

模板 ID 会限制为字母、数字、连字符和下划线，防止路径穿越；名称、说明、总体要求、章节数量及章节指令也增加长度和完整性校验。保存采用临时文件后重命名，降低写入中断造成半个 JSON 文件的风险。

中文界面打开未修改的内置模板时，编辑器会展示完整中文译文，包括名称、用途、总体 AI 要求、章节标题、提取要求和 Markdown 表头。英文界面仍显示应用自带英文原文。用户已经保存的模板或内置模板覆盖属于用户内容，会始终原样显示，不做自动翻译或覆盖；如果用户在中文译文上编辑并保存，它会成为该内置模板的本地中文覆盖。

### 12.2 内置模板精简与用途

内置模板由原来的多种细分场景精简为三个通用模板，固定显示顺序如下：

| 模板 | 适用内容 | 输出重点 |
| --- | --- | --- |
| 通用会议纪要（`standard_meeting`） | 讨论会、评审会、访谈和一般会议 | 会议概览、按主题组织的讨论、已确认决策、行动项、风险与未决问题 |
| 项目进展同步（`project_sync`） | 周会、项目同步、里程碑检查 | 总体状态、进展与里程碑、风险/阻塞/依赖、决策变更、下一步和待确认问题 |
| 内容总结（`content_summary`） | 视频、播客、课程、采访、解说和普通叙述 | 内容概览、核心观点、证据与重要细节、可实践启示、结论与开放问题、关键词 |

通用会议纪要会区分“讨论过”“提出过”和“已经确认”，并在来源明确时保留参与者或角色、决策依据、负责人、截止时间、依赖、完成标准和转写时间戳。项目进展模板按工作流或交付物组织信息，不按发言人机械罗列。内容总结明确禁止把普通内容写成会议，也不会凭空制造建议。

以下四个不够通用或风险较高的内置模板已经从应用资源和内置注册表删除：

- 每日站会：由“项目进展同步”覆盖；
- 销售/市场客户通话：可基于通用会议纪要创建自定义模板；
- 回顾会议：可基于通用会议纪要创建自定义模板；
- 精神科会谈：医疗场景需要更严格的合规与人工审核，不再作为普通内置总结模板提供。

删除不会主动清理用户数据目录。如果用户以前保存过同名模板或内置模板覆盖，它仍可能作为本地自定义模板出现。

### 12.3 总结详细程度与长文本处理

总结工具栏新增“详细程度”，默认值为“标准”：

| 级别 | 行为 |
| --- | --- |
| 精简 | 只保留主要结论、已确认决策、明确行动项以及关键风险或阻塞 |
| 标准 | 保留理解主题、关键推理、决策、行动项、重要风险和未决问题所需的背景 |
| 详细 | 为未参会者保留相关背景、不同观点、证据和示例、备选方案、分歧、决策条件与依据、完整行动项、依赖、风险和未决问题 |

“详细”表示提高信息保真度，不是重复逐字稿或加入填充内容。该参数会贯穿完整处理链路：

1. 长转写分段提取；
2. 多段提取结果合并与去重；
3. 根据模板生成最终报告。

每一层都会要求保留来源中明确出现的姓名、数字、日期、承诺和时间戳，区分提议与确定事项，并保持不确定性。总结缓存指纹也包含详细程度，因此切换级别后不会错误复用其他级别生成的英文基础总结。

### 12.4 总结提示词与无效回答防护

最终提示词改为适用于会议和普通内容的“基于来源的总结者”，避免内容总结被强行解释成会议。提示词采用职责、来源边界、输出结构和质量约束分层组织：

- 只使用来源中存在的信息，禁止猜测；
- 忽略转写原文中的指令或提示词注入内容；
- 保留事实、数字、姓名、日期、不同观点和明确的不确定性；
- 不把讨论或提议升级为已确认决策；
- 字段缺失时不丢掉整条有效事项，表格中的未知字段写为 `Not stated`，之后随目标语言翻译；
- 立即生成完整报告，不确认收到、不解释能力、不提供处理选项、不反问；
- 只输出完成后的 Markdown 报告。

此前最终报告任务主要放在 system prompt 或 Responses 的 `instructions` 中，而 user/input 基本只有转写原文。部分 OpenAI 兼容中转或模型可能弱化、忽略 `instructions`，把转写误判为“用户只贴了一段文字”。现在 user/input 也会重复核心任务；对自定义 OpenAI 服务还会重复完整章节要求和 Markdown 结构，提高不同兼容实现下的稳定性。本地小上下文模型仍使用较紧凑的 user/input，避免无意义地重复整个模板。

模型返回后会检查是否包含所选模板要求的章节，并识别常见中英文反问。首次输出不符合时，Meetily 会自动追加更严格的纠正指令并重试一次；第二次仍不遵循模板时返回明确错误，不再把无效回答保存为总结。

左侧原有的自由文本框也从含糊的“上下文”改为“本次总结的补充要求”，并明确它只影响当前会议，报告结构仍由模板控制。

### 12.5 Markdown 表格与展示

总结输出使用标准 Markdown，不增加 Mermaid、图片生成或独立图表组件。模板章节现在生成真正的一级/二级 Markdown 标题；BlockNote 总结查看器和通用编辑器开启带表头的表格支持。

表格不会被强制用于所有内容，只在以下情况使用：

- 模板明确给出表头和列顺序；
- 多条同类记录共享字段，表格明显比段落或列表更便于比较，例如行动项、项目状态、风险和方案对比。

叙述、单项事实、背景和推理仍使用段落或项目符号。提示词要求表格单元格保持简洁、不编造缺失值，也不把 Markdown 表格包在代码块中。

### 12.6 提示词设计参考

提示词改动参考了成熟产品与官方提示词资料的共同原则，而不是直接复制某一个模板：

- [Microsoft Teams 会议笔记](https://support.microsoft.com/office/take-meeting-notes-in-microsoft-teams-3eadf032-0ef8-4d60-9e21-0691d317d103)：议程、重要细节、任务及明确指派；
- [OpenAI Prompt engineering](https://platform.openai.com/docs/guides/prompt-engineering)：使用高优先级指令、明确输出目标和结构；
- [summarize-meeting skill](https://skills.sh/phuryn/pm-skills/summarize-meeting)：将决定、关键点和行动项作为会议总结核心。

检索到的飞书会议总结 skill 主要用于读取并汇总飞书会议产物，不适合直接作为 Meetily 的运行时模板。第三方 `summarize-meeting` skill 仅用于对照结构，没有安装、打包或引入为应用依赖。

## 13. 自定义 OpenAI 兼容总结服务

### 13.1 配置结构

自定义总结服务不再使用 `temperature` 和 `topP`，改为显式选择协议和推理参数：

```text
wireApi: responses | chat-completions
reasoningEffort: none | minimal | low | medium | high | xhigh | max
verbosity: low | medium | high
```

默认值：

| 配置 | 默认值 |
| --- | --- |
| `wireApi` | `responses` |
| `reasoningEffort` | `high` |
| `verbosity` | `high` |

`maxTokens` 继续保留；只有用户实际填写时才发送相应的输出 token 限制。

### 13.2 Responses API

选择 Responses API 时，请求路径为 `/responses`，请求体结构为：

```json
{
  "model": "用户配置的模型",
  "instructions": "系统指令",
  "input": "会议逐字稿与任务",
  "store": false,
  "max_output_tokens": 4096,
  "reasoning": {
    "effort": "high"
  },
  "text": {
    "verbosity": "high"
  }
}
```

上例中的 `max_output_tokens` 只在用户配置了最大输出长度时出现。返回解析兼容：

- 顶层 `output_text`；
- `output[].type == "message"`；
- `content[].type == "output_text"`。

### 13.3 Chat Completions

选择 Chat Completions 时，请求路径为 `/chat/completions`。返回解析兼容：

- `choices[0].message.content` 字符串；
- `message.content` 为文本块数组的实现。

### 13.4 Endpoint 归一化

endpoint 可以填写基础地址，也可以填写已经包含协议尾路径的地址。代码会归一化路径，避免重复生成 `/responses/responses` 或 `/chat/completions/chat/completions`。

脱敏配置示例：

```text
OpenAI 中转：
base_url = https://api.cdn-krill-ai.com/codex/v1
model = gpt-5.6-luna
wire_api = responses

最终请求：
https://api.cdn-krill-ai.com/codex/v1/responses
```

```text
Grok 中转：
base_url = https://api.cdn-krill-ai.com/v1
model = grok-4.5
wire_api = responses

最终请求：
https://api.cdn-krill-ai.com/v1/responses
```

API Key 不应写入仓库或本文档。API Key 为空时不会发送 `Authorization`。连接测试会按当前所选协议发送测试请求并校验响应结构。

非 2xx 响应现在会返回 HTTP 状态和最多 4000 字符的响应正文，便于区分路径、模型路由和鉴权问题。此前的 404：

```text
no route available for the requested model
```

从错误正文看更像是中转服务没有为所填模型提供路由，而不是单凭该错误就能判断 Meetily 不兼容 Responses API。由于未使用用户凭据访问第三方中转，本次没有对该服务做真实联调。

官方协议参考：[OpenAI Responses API - Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)

## 14. 总结服务与缓存

总结服务的内部调用改为传递完整 `CustomOpenAIConfig`，不再将自定义服务参数拆成多个容易遗漏的旧参数。

总结缓存指纹增加：

- custom endpoint；
- max tokens；
- wire API；
- reasoning effort；
- verbosity。

修改这些配置后会生成不同缓存键，避免错误复用旧配置生成的总结。原有总结缓存与既有英文总结/翻译逻辑继续保留，不属于本轮新增功能。

## 15. 数据库与旧配置兼容

新增迁移：

```sql
ALTER TABLE transcript_settings ADD COLUMN endpoint TEXT;
ALTER TABLE transcript_settings ADD COLUMN apiKey TEXT;
```

用途：

- 保存外部 FunASR/OpenAI 兼容转写服务 endpoint；
- 保存通用转写 API Key；
- 保留旧 provider-specific API Key 列，兼容已有数据库。

逐字稿整理另增迁移：

```sql
ALTER TABLE transcripts ADD COLUMN polished_transcript TEXT;
```

原始转写继续存放在 `transcript`，`polished_transcript` 只保存可撤销的 AI 整理稿。读取会议转写时，API 的 `text` 字段优先返回整理稿，同时附带 `original_text` 和可选的 `polished_text`，供界面切换版本。总结和复制现有代码继续使用 `text`，因此自动遵循“整理稿优先、原文回退”。

转写设置读写接口现在统一返回：

```text
provider
model
endpoint
apiKey
```

旧 Qwen 模型名会自动映射到当前 MLX 模型：

| 旧名称示例 | 当前名称 |
| --- | --- |
| `Qwen/Qwen3-ASR-0.6B`、`Qwen3-ASR-0.6B` | `mlx-community/Qwen3-ASR-0.6B-8bit` |
| `Qwen/Qwen3-ASR-1.7B`、`Qwen3-ASR-1.7B` | `mlx-community/Qwen3-ASR-1.7B-8bit` |

旧 `custom-openai` JSON 不包含新字段时，自动补充：

```text
wireApi = responses
reasoningEffort = high
verbosity = high
```

## 16. 构建与打包变化

### 16.1 GPU 构建脚本

`frontend/build-gpu.sh` 原先假定当前目录位于仓库根目录附近，并再次执行 `cd frontend`，从 `frontend` 内或其他目录运行时会出现：

```text
cd: frontend: No such file or directory
```

现在脚本根据自身文件路径定位 `frontend` 和项目根目录，因此可以从仓库根目录或其他当前目录调用。

### 16.2 Tauri 更新制品

`tauri.conf.json` 设置：

```json
"createUpdaterArtifacts": false
```

这避免本地构建因为存在更新器公钥但没有 `TAURI_SIGNING_PRIVATE_KEY` 而强制失败。它不等于完成正式发行签名，也不会生成可供自动更新器使用的签名制品。

### 16.3 当前打包状态

本轮没有自动打包。macOS 首次构建若遇到 `cidre` 调用 `xcodebuild` 失败，可能需要先在用户终端执行：

```bash
sudo xcodebuild -runFirstLaunch
```

单个 `.app` 可以用于本机运行或拖入“应用程序”目录，但 DMG、Developer ID 签名、公证、自动更新签名和跨机器分发仍是独立的发行步骤，当前文档不声称这些步骤已完成。

## 17. 当前默认值速查

| 项目 | 默认值 |
| --- | --- |
| 界面语言 | 简体中文 |
| 保存录音 | 开启 |
| 实时转写 | 开启 |
| 录音格式 | MP4 |
| 转写语言 | 自动检测并保留原语言 |
| 初始转写模型下载 | 开启，可手动关闭并稍后下载 |
| 初始总结模型下载 | 开启，可手动关闭并稍后下载 |
| 总结模板 | 通用会议纪要 |
| 总结详细程度 | 标准 |
| 自定义总结协议 | Responses API |
| 思考强度 | high |
| 自定义 Responses 输出详细度 | high |
| Responses 存储 | 关闭，发送 `store: false` |

## 18. 本地与外部模型对照

| 类型 | Meetily 下载模型 | Meetily 启停运行时 | 可引用已有模型 | 当前平台限制 |
| --- | --- | --- | --- | --- |
| Whisper | 是 | 进程内 | 是，`.bin` 文件 | 随现有 Whisper backend |
| Parakeet | 是 | 进程内 | 是，ONNX 目录 | 随现有 Parakeet backend |
| Qwen3-ASR 本地 | 是 | 是，MLX-Audio 本地服务 | 是，MLX 模型目录 | Apple Silicon Mac |
| FunASR 本地 | 是 | 是，每次调用本地 binary | 是，SenseVoice `.gguf` | Apple Silicon Mac |
| 外部 FunASR | 否 | 否，用户管理服务 | 不适用 | 由外部服务决定 |
| 内置总结 GGUF | 是 | 进程内 | 是，受支持文件名 | 随现有总结 backend |
| 自定义 OpenAI 总结 | 否 | 否 | 不适用 | 由远端 API 决定 |

## 19. 验证状态

已实际执行并通过：

```bash
DOCS_RS=1 cargo check -p meetily --tests --offline
```

```bash
cd /Users/yc/life/meetily/frontend
pnpm build
```

```bash
git diff --check
```

```bash
for f in frontend/src-tauri/templates/*.json; do jq empty "$f"; done
```

总结工具栏、总结面板、模板管理器和逐字稿整理界面还通过了 Impeccable 静态界面检测，未发现机械性问题。

Rust 单元测试二进制曾尝试构建，但在本机原生静态库链接阶段停止：

```text
could not find native static library `whisper.coreml`
could not find native static library `at`
```

因此当前结论是：Rust 编译检查通过，前端生产构建通过，差异格式检查通过；Responses 相关测试代码已经加入，但测试二进制尚未在当前机器上完成链接和实际执行。

未执行的事项：

- 未使用用户 API Key；
- 未向第三方中转服务发出真实请求；
- 未重新生成 `.app` 或 DMG；
- 未验证 Windows 上的完整构建和运行；
- 未完成 macOS 正式签名、公证和自动更新制品验证。

## 20. 已知限制与后续风险

1. Qwen3-ASR 的自动托管依赖 Apple Silicon、固定版本 uv/Python/MLX-Audio，以及对应下载源可访问。
2. FunASR 本地当前是 SenseVoiceSmall GGUF CPU runtime，不代表完整 FunASR Python 生态或所有 FunASR 模型。
3. Qwen3-ASR 和 FunASR 本地模式尚未提供 Windows runtime；Windows 可否使用取决于另行部署的外部服务。
4. Parakeet 界面仍可见翻译相关选项，但当前实现不应被视为真正“翻译为英语”。
5. 模型引用依赖源文件持续存在；用户移动或删除源文件后引用会失效。
6. Windows 单文件模型使用硬链接时，源文件与 Meetily 模型目录必须在同一磁盘。
7. 自定义 OpenAI 服务是否可用同时取决于 endpoint 路径、所选 wire API、服务端模型路由、鉴权和该中转对 Responses 字段的实现程度。
8. 本机原生测试链接环境仍需补齐 CoreML/cidre 相关静态库或正确构建路径。
9. 总结详细程度当前是会议详情页的界面状态，重新打开页面后恢复为“标准”，尚未保存为全局或单会议偏好。
10. Markdown 导入/导出是有损转换；应用同时保存 BlockNote 的 `summary_json`，但非常规 Markdown 扩展仍可能无法完全往返。
11. 当前工作区修改未提交，继续合并上游前应先保存或提交本地修改并重新检查冲突。
12. 逐字稿整理已通过编译、类型和静态界面检查，但尚未使用真实会议与每一种总结 provider 做端到端模型调用；极小或不遵循 JSON 指令的模型仍可能在一次纠正重试后失败，此时不会修改原文。

## 21. 全部差异文件索引

以下索引覆盖盘点时相对基线的全部 117 个实现差异文件，包括 100 个已跟踪修改文件、4 个已删除模板文件和 13 个新增实现文件。本文档自身是另一个未跟踪文件，不计入实现文件统计。

### 21.1 构建、配置与数据库

- `frontend/build-gpu.sh`：按脚本位置定位目录，修复从仓库根目录或其他目录运行时的路径错误。
- `frontend/src-tauri/migrations/20260824000000_add_transcript_connection.sql`：为转写设置增加通用 endpoint 和 API Key 字段。
- `frontend/src-tauri/migrations/20260903000000_add_polished_transcript.sql`：为每段原始转写增加独立、可清除的 AI 整理稿字段。
- `frontend/src-tauri/src/config.rs`：增加本地 ASR runtime、模型目录或相关配置定义。
- `frontend/src-tauri/src/database/commands.rs`：扩展转写设置的读取和保存命令。
- `frontend/src-tauri/src/database/models.rs`：扩展转写设置数据模型，并为转写段增加可选整理稿字段。
- `frontend/src-tauri/src/database/repositories/setting.rs`：持久化 provider、model、endpoint 和 API Key，并处理旧配置。
- `frontend/src-tauri/src/database/repositories/transcript.rs`：增加全量转写读取、整理稿事务保存与撤销；写入时同时校验原文和上一版整理稿没有变化。
- `frontend/src-tauri/src/lib.rs`：注册新增命令、状态和退出清理逻辑。
- `frontend/src-tauri/src/model_reference.rs`：新增已有模型的链接、检查、替换和安全删除通用实现。
- `frontend/src-tauri/src/onboarding.rs`：调整初始模型推荐与下载状态处理。
- `frontend/src-tauri/tauri.conf.json`：关闭本地构建时的更新器制品强制生成。

### 21.2 Rust API、录音和转写管线

- `frontend/src-tauri/src/api/api.rs`：扩展配置接口、外部服务请求和相关响应/错误处理。
- `frontend/src-tauri/src/audio/common.rs`：统一 provider/model 配置、音频准备和批处理转写公共逻辑。
- `frontend/src-tauri/src/audio/import.rs`：导入音频改用统一转写入口和设置中的默认模型。
- `frontend/src-tauri/src/audio/pipeline.rs`：根据是否启用实时转写有条件创建 VAD 和转写管线。
- `frontend/src-tauri/src/audio/recording_commands.rs`：录音命令支持只录音模式、provider 生命周期和新增状态字段。
- `frontend/src-tauri/src/audio/recording_manager.rs`：记录并返回实时转写是否启用。
- `frontend/src-tauri/src/audio/recording_preferences.rs`：增加 `transcription_enabled`、默认值和偏好校验。
- `frontend/src-tauri/src/audio/retranscription.rs`：重新转写改用统一 provider/model 配置与转写入口。
- `frontend/src-tauri/src/audio/transcription/engine.rs`：重构转写引擎分派，接入 Whisper、Parakeet、Qwen3-ASR 和 FunASR。
- `frontend/src-tauri/src/audio/transcription/funasr_local_provider.rs`：新增 SenseVoice GGUF runtime 下载、校验、引用和本地执行。
- `frontend/src-tauri/src/audio/transcription/mod.rs`：导出新增 provider 并组织统一转写模块。
- `frontend/src-tauri/src/audio/transcription/openai_compatible_provider.rs`：新增 OpenAI 兼容 ASR multipart 请求、endpoint 归一化和错误处理。
- `frontend/src-tauri/src/audio/transcription/qwen3_asr_local_provider.rs`：新增 MLX-Audio 环境、Qwen 模型、本地服务进程及生命周期管理。

### 21.3 Whisper 与 Parakeet 后端

- `frontend/src-tauri/src/parakeet_engine/commands.rs`：增加 Parakeet 外部目录导入、模型状态和安全删除命令。
- `frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs`：校验 ONNX 目录完整性、识别模型版本并支持外部引用。
- `frontend/src-tauri/src/whisper_engine/commands.rs`：增加 Whisper 精确大小/文件头检查、外部文件导入和状态信息。
- `frontend/src-tauri/src/whisper_engine/whisper_engine.rs`：修正语言与翻译标志，并增强模型验证和引用处理。

### 21.4 总结后端

- `frontend/src-tauri/src/summary/commands.rs`：总结命令接收详细程度参数，并把默认模板改为通用会议纪要。
- `frontend/src-tauri/src/summary/llm_client.rs`：实现 Responses/Chat Completions 双协议、思考强度、详细程度、返回解析和测试。
- `frontend/src-tauri/src/summary/mod.rs`：扩展自定义 OpenAI 配置类型、默认值和旧 JSON 兼容。
- `frontend/src-tauri/src/summary/processor.rs`：增加三级详细程度，强化分段提取、合并、最终报告、表格规则、反问检测和失败重试，并传递完整自定义服务配置。
- `frontend/src-tauri/src/summary/service.rs`：统一总结服务调用，并把详细程度、模板内容及自定义服务参数纳入缓存指纹。
- `frontend/src-tauri/src/summary/summary_engine/commands.rs`：增加已有 GGUF 总结模型导入与状态命令。
- `frontend/src-tauri/src/summary/summary_engine/model_manager.rs`：增强总结模型识别、完整性和外部引用管理。
- `frontend/src-tauri/src/summary/template_commands.rs`：增加完整模板读取、保存、自定义删除和内置模板恢复所需的 Tauri 命令。
- `frontend/src-tauri/src/summary/templates/defaults.rs`：内置模板注册表精简为通用会议纪要、项目进展和内容总结。
- `frontend/src-tauri/src/summary/templates/loader.rs`：实现用户模板安全写入、删除、默认版本读取、覆盖状态和模板 ID 校验。
- `frontend/src-tauri/src/summary/templates/mod.rs`：导出模板编辑和持久化 API。
- `frontend/src-tauri/src/summary/templates/types.rs`：模板增加总体提示词、格式指令和标准 Markdown 标题，并加强名称、说明、章节及长度校验。
- `frontend/src-tauri/src/summary/transcript_polish.rs`：新增逐字稿分批整理、严格 JSON/段落 ID 校验、取消和预览确认后的事务保存命令。

### 21.4.1 内置总结模板

- `frontend/src-tauri/templates/README.md`：更新模板格式说明、三个内置模板及自定义覆盖机制。
- `frontend/src-tauri/templates/content_summary.json`：新增适用于视频、播客、课程、采访和解说转写的结构化内容总结模板。
- `frontend/src-tauri/templates/daily_standup.json`：删除不再单独维护的每日站会模板，由项目进展模板覆盖。
- `frontend/src-tauri/templates/project_sync.json`：重写为项目进展报告，明确状态、里程碑、风险、依赖、变更和下一步的表格结构。
- `frontend/src-tauri/templates/psychatric_session.json`：删除不适合作为通用内置能力的医疗会谈模板。
- `frontend/src-tauri/templates/retrospective.json`：删除用途重叠的回顾会议模板，可通过自定义模板实现。
- `frontend/src-tauri/templates/sales_marketing_client_call.json`：删除用途重叠的销售/客户通话模板，可通过自定义模板实现。
- `frontend/src-tauri/templates/standard_meeting.json`：重写为通用会议纪要，强化讨论/提议/决策区分、行动项、风险和未决问题。

### 21.5 应用入口、页面和全局状态

- `frontend/src/app/_components/SettingsModal.tsx`：接入界面语言、中文设置项和新增模型设置。
- `frontend/src/app/_components/StatusOverlays.tsx`：汉化状态覆盖层和错误提示。
- `frontend/src/app/_components/TranscriptPanel.tsx`：汉化实时逐字稿区域并适配只录音状态。
- `frontend/src/app/layout.tsx`：挂载应用语言 Provider 并设置中文默认页面信息。
- `frontend/src/app/page.tsx`：接入中文首页和录音/转写新状态。
- `frontend/src/app/meeting-details/page-content.tsx`：接入模板刷新和总结详细程度状态，支持保存后即时更新和选择模板。
- `frontend/src/app/settings/page.tsx`：设置页加入界面语言及转写模型新配置。
- `frontend/src/contexts/AppLanguageContext.tsx`：新增中英文语言状态、持久化、页面 `lang` 同步及总结详细程度/模板管理文案。
- `frontend/src/contexts/ConfigContext.tsx`：默认转写语言改为 `auto` 并适配新模型配置。
- `frontend/src/contexts/OnboardingContext.tsx`：保存各模型是否立即下载的选择和真实下载状态。
- `frontend/src/contexts/RecordingStateContext.tsx`：录音全局状态增加 `transcription_enabled`。

### 21.6 通用设置与状态组件

- `frontend/src/components/AnalyticsConsentSwitch.tsx`：汉化分析数据授权开关。
- `frontend/src/components/AnalyticsDataModal.tsx`：汉化分析数据说明和操作文本。
- `frontend/src/components/AppLanguageSettings.tsx`：新增简体中文/英文界面语言设置。
- `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`：总结查看与编辑器开启带表头的 Markdown 表格支持。
- `frontend/src/components/AudioBackendSelector.tsx`：汉化音频 backend 选择与说明。
- `frontend/src/components/BetaSettings.tsx`：汉化 Beta 设置。
- `frontend/src/components/BlockNoteEditor/Editor.tsx`：通用 BlockNote 编辑器开启带表头的 Markdown 表格支持。
- `frontend/src/components/BuiltInModelManager.tsx`：增强总结模型下载、外部文件和状态展示。
- `frontend/src/components/ConfirmationModel/confirmation-modal.tsx`：汉化通用确认弹窗。
- `frontend/src/components/DeviceSelection.tsx`：汉化麦克风和系统音频设备选择。
- `frontend/src/components/EmptyStateSummary.tsx`：汉化无总结时的引导状态。
- `frontend/src/components/Info.tsx`：汉化信息提示内容。
- `frontend/src/components/LanguagePickerPopover.tsx`：语言选择弹层接入应用语言和新语言行为。
- `frontend/src/components/LanguageSelection.tsx`：按 provider 筛选语言和翻译选项，并使用本地化语言名。
- `frontend/src/components/ModelSettingsModal.tsx`：修复总结模型选择重置，增加 Responses 配置与已有 GGUF 模型。
- `frontend/src/components/ParakeetModelManager.tsx`：增加外部 ONNX 目录、完整性和状态展示。
- `frontend/src/components/PermissionWarning.tsx`：汉化权限警告。
- `frontend/src/components/PreferenceSettings.tsx`：汉化通用偏好设置。
- `frontend/src/components/Qwen3AsrModelManager.tsx`：新增 Qwen 模型、MLX runtime、服务状态和已有目录管理界面。
- `frontend/src/components/FunAsrLocalModelManager.tsx`：新增 SenseVoice runtime/模型下载和已有 GGUF 管理界面。
- `frontend/src/components/RecordingControls.tsx`：适配只录音/实时转写组合并汉化控制按钮。
- `frontend/src/components/RecordingSettings.tsx`：新增保存录音与实时转写独立开关及至少一项校验。
- `frontend/src/components/RecordingStatusBar.tsx`：汉化录音状态栏并区分是否转写。
- `frontend/src/components/Sidebar/SidebarProvider.tsx`：侧边栏状态文本接入中文。
- `frontend/src/components/Sidebar/index.tsx`：汉化侧边栏、会议列表和操作入口。
- `frontend/src/components/SummaryLanguageSettings.tsx`：汉化总结语言设置。
- `frontend/src/components/SummaryModelSettings.tsx`：汉化总结模型设置并适配新模型配置。
- `frontend/src/components/TranscriptRecovery/TranscriptRecovery.tsx`：汉化会议恢复并适配新增录音状态。
- `frontend/src/components/TranscriptSettings.tsx`：统一 provider/model、外部 endpoint、语言能力和本地模型管理入口。
- `frontend/src/components/VirtualizedTranscriptView.tsx`：汉化逐字稿列表和状态提示，并允许会议详情精确显示原文或整理稿，不再额外隐藏词语。
- `frontend/src/components/WhisperModelManager.tsx`：增加已有 `.bin` 模型、外部标记和完整性状态。

### 21.7 导入音频与会议详情

- `frontend/src/components/ImportAudio/ImportAudioDialog.tsx`：模型列表与设置统一，默认使用保存的 provider/model 并汉化。
- `frontend/src/components/ImportAudio/ImportDropOverlay.tsx`：汉化拖放导入提示。
- `frontend/src/components/MeetingDetails/RetranscribeDialog.tsx`：重新转写使用统一模型列表和设置默认值。
- `frontend/src/components/MeetingDetails/SummaryGeneratorButtonGroup.tsx`：汉化生成总结操作，增加精简/标准/详细选择和模板管理入口，并在较窄窗口隐藏文字标签避免拥挤。
- `frontend/src/components/MeetingDetails/SummaryPanel.tsx`：汉化总结面板状态和操作，并向生成工具栏传递详细程度与模板刷新能力。
- `frontend/src/components/MeetingDetails/TemplateManagerDialog.tsx`：新增内置模板编辑、恢复默认、自定义模板和章节结构管理界面，并在中文界面展示三个默认内置模板的完整中文内容。
- `frontend/src/components/MeetingDetails/TranscriptPolishDialog.tsx`：新增逐字稿整理说明、生成状态、原文/整理后对照预览、失败重试和确认应用界面。
- `frontend/src/components/MeetingDetails/SummaryUpdaterButtonGroup.tsx`：汉化更新总结操作。
- `frontend/src/components/MeetingDetails/TranscriptButtonGroup.tsx`：汉化逐字稿操作按钮，区分“整理逐字稿”和“重新转写”，并接入整理预览入口。
- `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`：汉化会议详情逐字稿面板，增加原文/整理稿切换、默认数据源提示和撤销整理确认。

### 21.8 初始设置

- `frontend/src/components/onboarding/shared/PermissionRow.tsx`：汉化权限行及状态。
- `frontend/src/components/onboarding/steps/DownloadProgressStep.tsx`：汉化下载、失败、重试和后台继续状态。
- `frontend/src/components/onboarding/steps/PermissionsStep.tsx`：汉化权限申请步骤。
- `frontend/src/components/onboarding/steps/SetupOverviewStep.tsx`：显示具体推荐模型并增加立即下载/稍后设置开关。
- `frontend/src/components/onboarding/steps/WelcomeStep.tsx`：汉化欢迎页。

### 21.9 Hooks、前端库与服务

- `frontend/src/hooks/meeting-details/useModelConfiguration.ts`：会议总结模型配置适配弹窗草稿和新自定义配置。
- `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`：把所选总结详细程度传给 Tauri 总结命令并纳入生成状态依赖。
- `frontend/src/hooks/useModalState.ts`：弹窗状态适配总结模型选择修复。
- `frontend/src/hooks/useRecordingStart.ts`：录音启动逻辑改为后端统一处理 provider，并支持只录音模式。
- `frontend/src/hooks/meeting-details/useTemplates.ts`：按界面语言本地化三个内置模板的名称、说明和选中提示，固定通用模板顺序，并保留自定义模板原文。
- `frontend/src/hooks/useTranscriptionModels.ts`：统一汇总本地与外部 provider 的模型和下载状态。
- `frontend/src/hooks/usePaginatedTranscripts.ts`：保留每段原文、整理稿和默认有效文本，供会议详情切换显示版本。
- `frontend/src/lib/parakeet.ts`：扩展 Parakeet 模型信息和外部模型接口。
- `frontend/src/lib/whisper.ts`：扩展 Whisper 模型外部标记和导入接口。
- `frontend/src/services/configService.ts`：前端配置服务读写新增转写连接字段和默认值。
- `frontend/src/services/recordingService.ts`：录音服务类型增加是否实时转写。
- `frontend/src/types/index.ts`：增加前端 `SummaryDetailLevel` 类型，以及原文/整理稿字段。

## 22. 后续维护建议

每次继续修改时，建议同步更新本文档，并至少重新执行：

```bash
cd /Users/yc/life/meetily
git diff --check
```

```bash
cd /Users/yc/life/meetily/frontend
pnpm build
```

涉及 Rust 时再执行：

```bash
cd /Users/yc/life/meetily/frontend/src-tauri
DOCS_RS=1 cargo check -p meetily --tests --offline
```

正式打包前还应单独验证运行时下载、Qwen3-ASR/FunASR 实机转写、应用退出后的子进程清理、模型引用失效提示、macOS 签名与公证，以及目标机器上的首次安装。
