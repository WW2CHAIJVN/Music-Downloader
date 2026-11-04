# Music Downloader

[简体中文](README.md) | **[English]** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Español](README.es.md) | [Français](README.fr.md)

Batch playlist downloader for NetEase Cloud Music, built as an Electron desktop GUI.

Paste a playlist link or ID, pick a quality tier, and it downloads the whole playlist while writing ID3 tags and cover art automatically.

## Features

- Supports playlist links, playlist IDs, album links, toplist links, and track-list `.txt` files (each line starting with a song ID)
- 10 quality tiers: standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- Falls back along a quality chain when the requested tier is unavailable, and marks the downgrade in the log
- Live progress counters (succeeded / skipped / failed / trial-only) with a scrolling log
- QR-code login or pasted cookie, for VIP and lossless tracks
- Resumable downloads (existing files over 10 KB are skipped); stops automatically when free disk space drops below 1.5 GB
- Bundled NetEase API server (`@neteasecloudmusicapienhanced/api`), no separate process needed

## Project layout

```
src/core/       download core (download.js / match.js / login.js / rules.json)
src/main/       Electron main process and preload
src/renderer/   UI (HTML / CSS / JS)
```

## Development

```powershell
npm install
npm start
```

### Build the installer

```powershell
npm run dist
```

Output goes to `release/`:
- `MusicDownloader-Setup-<version>.exe` — NSIS installer
- `win-unpacked/MusicDownloader.exe` — portable build

## Command line

`src/core/download.js` also works without the GUI:

```powershell
node src/core/download.js <playlist-link|ID|songs.txt> --level sky --out D:\Music
```

Common options:

| Option | Description |
|---|---|
| `--level` | Quality tier, defaults to lossless |
| `--chain` | Fallback chain, comma separated, e.g. `jymaster,lossless` |
| `--out` | Output directory |
| `--cookie` / `--cookie-file` | Login cookie |
| `--concurrency` | Worker count, defaults to 4 |
| `--limit` | Only download the first N tracks |
| `--no-tag` | Skip tags and cover art |
| `--dry-run` | Resolve tracks without downloading |

Requires a local API server:

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## Notes

- Without login, VIP tracks only return a 45-second preview clip; the script detects this, skips the track, and records it in `_result.json`
- The login cookie is stored in the user data directory — **never commit it**
- The downloaded audio remains the property of its rights holders; use it for personal, lawful purposes only

## Dependencies

- `@neteasecloudmusicapienhanced/api` — NetEase API (community-maintained fork)
- Electron / electron-builder
- ffmpeg (for tags and cover art; must be on `PATH`)
