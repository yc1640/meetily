# Meetily 定制版发布与自动更新

本文说明 `yc1640/meetily` 的版本、macOS 安装包和 Tauri 自动更新发布流程。本 fork 的版本与上游仓库相互独立；即使版本号相同，更新地址和签名密钥也不同。

## 当前发布范围

- 当前版本：`0.4.1`
- 更新仓库：`yc1640/meetily`
- 自动更新清单：`https://github.com/yc1640/meetily/releases/latest/download/latest.json`
- 自动发布平台：Apple Silicon macOS
- GitHub Actions 工作流：`.github/workflows/release.yml`

Windows 和 Intel Mac 暂不进入自动发布矩阵。Windows 需要先验证本 fork 的运行路径、安装器签名和更新行为；Qwen3-ASR 的 MLX-Audio 本地模式本身也不支持 Windows。

## 更新签名密钥

Tauri 更新签名密钥与 GitHub SSH 密钥、Apple Developer ID 证书是三种不同用途的凭证，不能互相替代。

本机已生成：

```text
私钥：~/.tauri/meetily-updater.key
公钥：~/.tauri/meetily-updater.key.pub
```

只有公钥会写入 `frontend/src-tauri/tauri.conf.json`。私钥不得提交、粘贴到 Issue、日志或聊天中。请把私钥离线备份到安全位置；如果私钥丢失，已经安装的客户端将无法验证用新密钥签名的更新。

此密钥生成时没有设置密码，因此无需创建 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。安全性依赖于本机文件权限、离线备份和 GitHub Secret 的访问控制。

## 首次配置 GitHub Secret

在本机复制私钥内容：

```bash
pbcopy < ~/.tauri/meetily-updater.key
```

然后打开当前仓库：

```text
Settings → Secrets and variables → Actions → New repository secret
```

创建：

```text
Name: TAURI_SIGNING_PRIVATE_KEY
Secret: 粘贴刚复制的完整私钥内容
```

不要把私钥写入工作流 YAML。发布工作流会在创建 Release 前检查此 Secret 是否存在，但不会输出其内容。

## 日常本地打包与正式发布的区别

默认配置 `frontend/src-tauri/tauri.conf.json` 保持：

```json
{
  "bundle": {
    "createUpdaterArtifacts": false
  }
}
```

因此日常执行 `./frontend/build-gpu.sh` 不需要更新签名私钥。

正式发布时，工作流额外合并：

```text
frontend/src-tauri/tauri.release.conf.json
```

该文件只把 `createUpdaterArtifacts` 覆盖为 `true`。Tauri 会生成自动更新压缩包和 `.sig`，`tauri-action` 会生成并上传 `latest.json`。

## 发布步骤

1. 确认要发布的代码已经合并到 `main`，工作区和远端分支状态正确。
2. 同步修改以下版本号，保持完全一致：

   - `frontend/src-tauri/tauri.conf.json`
   - `frontend/src-tauri/Cargo.toml`
   - `frontend/package.json`
   - `Cargo.lock` 中 `meetily` 包的版本

3. 提交并推送版本修改。不要手动创建同名标签。
4. 在 GitHub 的 **Actions → Release → Run workflow** 中选择 `main` 并运行。
5. 工作流会检查版本标签是否已经存在，以及更新签名 Secret 是否已配置。
6. 工作流创建一个 Draft Release，构建 Apple Silicon macOS 安装包并上传：

   - DMG 安装包；
   - `.app.tar.gz` 自动更新包；
   - `.sig` 更新签名；
   - `latest.json` 更新清单。

7. 下载或检查这些文件，确认 `latest.json` 的版本、平台、下载地址和签名都存在。
8. 编辑发布说明，然后发布 Draft Release。

Draft 状态的 Release 不会成为 GitHub 的 `releases/latest`。只有正式发布后，客户端才能从固定地址检测到它。

## 版本规则

使用标准 SemVer：

- 修复：`0.4.1` → `0.4.2`
- 向后兼容的新功能：`0.4.2` → `0.5.0`
- 不兼容的大版本：`0.x` → `1.0.0`

发布工作流不会再自动创建 `0.4.1.1` 这类四段版本。如果标签已经存在，工作流会要求先在代码中显式升级版本。

## 首次迁移

此前构建的 `0.4.0` 客户端仍然内嵌上游 Meetily 的更新地址和公钥，无法通过上游清单安全地迁移到本 fork。

因此第一次需要手动下载安装本 fork 的 `0.4.1`。从 `0.4.1` 开始，应用会在启动约两秒后检查 `yc1640/meetily` 的最新正式 Release，也可从“关于”页面或托盘手动检查。

## macOS 签名说明

Tauri 更新签名只验证更新文件来自本 fork，不等于 Apple Developer ID 签名和公证。

当前 Release 工作流使用 ad-hoc 应用签名，不依赖上游的 Apple 开发者证书。首次从 DMG 安装时，macOS 仍可能显示未公证应用的安全提示。若要面向更多用户无提示分发，需要另外配置自己的 Apple Developer ID、证书、notarization 凭证，并在验证后把发布工作流的 `sign-binaries` 改为 `true`。

## 发布后验证

发布后至少检查：

```bash
curl -fL https://github.com/yc1640/meetily/releases/latest/download/latest.json
```

还应保留一个旧版本客户端，确认它能发现新版本、完成下载、通过签名验证、安装并重启。不要只验证 DMG 可以手动安装。
