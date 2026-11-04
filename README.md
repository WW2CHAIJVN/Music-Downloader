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
