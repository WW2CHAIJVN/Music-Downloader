## Music Downloader v1.2.0

这一版修好了「链接解析不了、单曲专辑下不了」，并加了歌名搜索和版本更新检查。

### 修复

- **短链 ENOENT**：`163cn.tv` 短链原先被当成文件路径去读，报 `ENOENT: no such file or directory, open 'V:\Music Downloader\MusicDownloader\https:\163cn.tv\bkoq5Znz'`。现在先跟随重定向展开成真实地址再解析。
- **单曲无法下载**：纯数字 ID 原先一律当歌单。新增 `song` 类型，纯数字走自动判断：先试歌单，失败再按单曲处理。
- **专辑无法下载**：两个原因，`/album` 不传 `s` 参数不返回曲目；曲目在顶层 `songs` 而非 `album.songs`。两处都已修正。
- **API 端口对不上**：`download.js` 默认连 `127.0.0.1:3001`，内置 API 实际在 `3141`，导致命令行调用全部 `fetch failed`。
- **失败提示更准确**：下架曲目现在报「已下架或无版权」，不再笼统说「无可用链接」。

### 新增

- **歌名搜索**：界面新增搜索框，输歌名（可带歌手）直接搜出候选并加入下载队列，配合「只下前 N 首」控制数量。命令行对应 `--search <关键词>`。
- **自动检查更新**：启动时和点右上角版本徽章时检查 GitHub 最新 release，有新版本会变黄并提示，点击直接打开发布页。

### 支持的输入

短链 `163cn.tv/xxx`、playlist / toplist / album / song 链接、纯数字歌单或歌曲 ID、曲目清单 txt、歌名搜索。

### 安装

下载 `MusicDownloader-Setup-1.2.0.exe` 运行安装。

### 说明

- 安装包未做代码签名，Windows 首次运行可能弹 SmartScreen 提示
- v1.0.0 与 v1.1.0 已标记为预发布版本
