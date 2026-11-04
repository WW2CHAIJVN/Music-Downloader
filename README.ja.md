# Music Downloader

[简体中文](README.md) | [English](README.en.md) | **[日本語]** | [한국어](README.ko.md) | [Русский](README.ru.md) | [Español](README.es.md) | [Français](README.fr.md)

NetEase Cloud Music（網易雲音楽）のプレイリスト一括ダウンローダー。Electron 製のデスクトップ GUI。

プレイリストのリンクまたは ID を貼り付け、音質を選ぶだけで、プレイリスト全体をダウンロードし、ID3 タグとカバー画像を自動で書き込みます。

## 機能

- プレイリストのリンク、プレイリスト ID、アルバムのリンク、ランキングのリンク、曲目リストの `.txt`（各行が曲 ID で始まるもの）に対応
- 10 段階の音質：standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- 指定した音質が使えない場合はフォールバック順に自動降格し、ログに「降級」と記録
- 進捗のリアルタイム集計（成功／スキップ／失敗／試聴のみ）とスクロールログ
- QR コードログインまたは cookie の貼り付けで、VIP・可逆圧縮の曲を取得
- レジューム対応（既存かつ 10KB 超のファイルはスキップ）、空き容量が 1.5GB を下回ると自動停止
- NetEase API サーバーを内蔵（`@neteasecloudmusicapienhanced/api`）。別途起動は不要

## ディレクトリ構成

```
src/core/       ダウンロード本体（download.js / match.js / login.js / rules.json）
src/main/       Electron メインプロセスと preload
src/renderer/   画面（HTML / CSS / JS）
```

## 開発

```powershell
npm install
npm start
```

### インストーラーのビルド

```powershell
npm run dist
```

出力先は `release/`：
- `MusicDownloader-Setup-<version>.exe` — NSIS インストーラー
- `win-unpacked/MusicDownloader.exe` — インストール不要版

## コマンドライン

`src/core/download.js` は GUI なしでも使えます：

```powershell
node src/core/download.js <プレイリストのリンク|ID|songs.txt> --level sky --out D:\Music
```

主なオプション：

| オプション | 説明 |
|---|---|
| `--level` | 音質。既定は lossless |
| `--chain` | フォールバック順。カンマ区切り（例：`jymaster,lossless`） |
| `--out` | 出力先ディレクトリ |
| `--cookie` / `--cookie-file` | ログイン cookie |
| `--concurrency` | 同時実行数。既定は 4 |
| `--limit` | 先頭 N 曲だけ取得 |
| `--no-tag` | タグとカバーを書き込まない |
| `--dry-run` | 曲目の解決のみ、ダウンロードしない |

ローカル API サーバーが必要です：

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## 注意事項

- 未ログインの場合、VIP 曲は 45 秒の試聴クリップしか返りません。スクリプトはこれを検出してスキップし、`_result.json` に記録します
- ログイン cookie はユーザーデータディレクトリに保存されます。**リポジトリにコミットしないでください**
- ダウンロードした音源の著作権は権利者に帰属します。個人的かつ合法な用途に限って使用してください

## 依存関係

- `@neteasecloudmusicapienhanced/api` — NetEase API（コミュニティ保守のフォーク）
- Electron / electron-builder
- ffmpeg（タグとカバー画像の書き込み。`PATH` に必要）
