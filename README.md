# Music Downloader

网易云音乐歌单批量下载器，Electron 桌面 GUI。

粘贴歌单链接或 ID，选音质档位，即可批量下载并自动写入 ID3 标签与封面。

## 功能

- 支持歌单链接、歌单 ID、专辑链接、榜单链接，以及曲目清单 txt（每行以歌曲 ID 开头）
- 10 档音质：standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- 目标档位无权限时按回落链自动降级，日志标注「降级」
- 实时进度统计（成功 / 跳过 / 失败 / 试听未下）与滚动日志
- 扫码登录或粘贴 cookie，用于获取 VIP / 无损曲目
- 断点续传（已存在且大于 10KB 的文件跳过）、磁盘剩余不足 1.5GB 自动停止
- 内置网易云 API 服务（`@neteasecloudmusicapienhanced/api`），无需另外启动
- 输入法组字保护：程序在组字途中改写输入框的值时，写入会挂到组字结束后补上，拼音不会再被提前提交（见下节）
- 界面重做（Ultraviolet 夜间配色，Outfit / Onest 字体本地打包，离线可读）：左侧设置、右侧「下载台账」，五个计数在细线之间，进度是一条会走满的紫色标尺

## 界面（1.1.0 起）

沿用 Ultraviolet 主题的夜间配色：深紫的黑底、一种紫在两级强度、细发丝线代替卡片描边、
药丸形控件。英文与数字用 Outfit 和 Onest，中文字形回落到系统里的微软雅黑 / Noto Sans SC。
字体文件已打包进仓库（`src/renderer/fonts/`），断网也能正常显示。

界面结构：

```
src/renderer/
  index.html   结构
  styles.css   页面样式（文件头是设计标记）
  tokens.css   颜色、字体、间距、动效时长
  base.css     基础规则
  fonts.css    本地字体的 @font-face
  fonts/       Outfit / Onest 的 woff2
```

## 输入法组字保护（1.1.0 起）

Chromium 在输入法组字（拼音未上屏）期间被改写控件时会取消这次组字：
`ni` + `hao` 可能落成「泥嚎」，或者干脆留下裸字母。纯 ASCII 输入不会触发，
因为那时没有组字可取消。

这套时序规则来自 DSH 插件 `ime-composer-guard`，那边兜住的是 contenteditable
的 `contentEditable` 属性；本应用没有 contenteditable，代价最大的是 `value`、
`disabled` 这类程序写入，所以同一套「组字期间挂起，组字结束重放最后请求值」
挪到了它们身上：

- 覆盖 `input` / `textarea` / `select` 的 `.value`、`.disabled`，以及
  `setAttribute` / `removeAttribute` 的 `value`、`disabled`、`placeholder`
- 只推迟写入时机，最终状态与不做保护时完全一致
- 用户在组字期间自己敲进去的内容不受影响

验证：

```powershell
npx electron scripts/verify-ime-guard.js
```

## 目录结构

```
src/core/       下载核心（download.js / match.js / login.js / rules.json）
src/main/       Electron 主进程与 preload
src/renderer/   界面（HTML / CSS / JS）
```

## 开发

```powershell
npm install
npm start
```

### 构建安装包

```powershell
npm run dist
```

产物在 `release/`：
- `MusicDownloader-Setup-<version>.exe` — NSIS 安装包
- `win-unpacked/MusicDownloader.exe` — 免安装版

### 打包产物启动即退出

如果 `win-unpacked\MusicDownloader.exe` 双击后闪一下就没了，先查环境变量：

```powershell
$env:ELECTRON_RUN_AS_NODE
```

它有值（通常是 `1`）时，Electron 会退化成纯 Node 解释器运行，主进程里那些 `app`、`BrowserWindow` 全是 undefined，进程于是立刻退出。
在某些终端里不会报错，看起来就像程序崩了。清掉再跑：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

判断是不是这个问题，跑一句就知道：正常应该输出 `v45.2.2`，而不是 Node 的版本号。

```powershell
npx electron --version
```

## 命令行用法

`src/core/download.js` 也可脱离 GUI 单独使用：

```powershell
node src/core/download.js <歌单链接|ID|songs.txt> --level sky --out D:\Music
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--level` | 音质档位，默认 lossless |
| `--chain` | 回落链，逗号分隔，如 `jymaster,lossless` |
| `--out` | 输出目录 |
| `--cookie` / `--cookie-file` | 登录 cookie |
| `--concurrency` | 并发数，默认 4 |
| `--limit` | 只下前 N 首 |
| `--no-tag` | 不写标签和封面 |
| `--dry-run` | 只解析不下载 |

需要本地 API 服务：

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## 使用须知

- 未登录时 VIP 曲目只会返回 45 秒试听片段，脚本识别后跳过并记录到 `_result.json`
- 登录 cookie 保存在用户数据目录，**不要提交到仓库**
- 下载的音源版权归原权利人所有，请仅用于个人合法用途

## 依赖

- `@neteasecloudmusicapienhanced/api` — 网易云 API（社区维护分支）
- Electron / electron-builder
- ffmpeg（写入标签与封面，需在 PATH 中）
