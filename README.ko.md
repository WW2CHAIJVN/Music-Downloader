# Music Downloader

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | **[한국어]** | [Русский](README.ru.md) | [Español](README.es.md) | [Français](README.fr.md)

네이버 클라우드 뮤직(NetEase Cloud Music) 플레이리스트 일괄 다운로더. Electron 데스크톱 GUI.

플레이리스트 링크나 ID를 붙여넣고 음질 단계를 고르면 플레이리스트 전체를 내려받으면서 ID3 태그와 커버 이미지를 자동으로 기록합니다.

## 기능

- 플레이리스트 링크, 플레이리스트 ID, 앨범 링크, 차트 링크, 그리고 곡 목록 `.txt` 파일(각 줄이 곡 ID로 시작) 지원
- 10단계 음질: standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- 요청한 음질을 쓸 수 없으면 폴백 순서로 자동 강등하고 로그에 "降級"으로 표시
- 실시간 진행 집계(성공 / 건너뜀 / 실패 / 미리듣기만)와 스크롤 로그
- QR 코드 로그인 또는 cookie 붙여넣기로 VIP 및 무손실 곡 다운로드
- 이어받기 지원(기존 파일이 10KB를 넘으면 건너뜀), 디스크 여유 공간이 1.5GB 아래로 떨어지면 자동 중지
- NetEase API 서버 내장(`@neteasecloudmusicapienhanced/api`), 별도 실행 불필요

## 디렉터리 구조

```
src/core/       다운로드 핵심(download.js / match.js / login.js / rules.json)
src/main/       Electron 메인 프로세스와 preload
src/renderer/   화면(HTML / CSS / JS)
```

## 개발

```powershell
npm install
npm start
```

### 설치 파일 빌드

```powershell
npm run dist
```

결과물은 `release/`에 생성됩니다:
- `MusicDownloader-Setup-<version>.exe` — NSIS 설치 파일
- `win-unpacked/MusicDownloader.exe` — 설치 불필요 버전

## 명령줄

`src/core/download.js`는 GUI 없이도 사용할 수 있습니다:

```powershell
node src/core/download.js <플레이리스트 링크|ID|songs.txt> --level sky --out D:\Music
```

주요 옵션:

| 옵션 | 설명 |
|---|---|
| `--level` | 음질 단계, 기본값 lossless |
| `--chain` | 폴백 순서, 쉼표 구분(예: `jymaster,lossless`) |
| `--out` | 출력 디렉터리 |
| `--cookie` / `--cookie-file` | 로그인 cookie |
| `--concurrency` | 동시 작업 수, 기본값 4 |
| `--limit` | 앞쪽 N곡만 다운로드 |
| `--no-tag` | 태그와 커버 이미지를 쓰지 않음 |
| `--dry-run` | 곡 목록만 확인하고 다운로드하지 않음 |

로컬 API 서버가 필요합니다:

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## 주의 사항

- 로그인하지 않으면 VIP 곡은 45초 미리듣기 클립만 반환됩니다. 스크립트가 이를 감지해 건너뛰고 `_result.json`에 기록합니다
- 로그인 cookie는 사용자 데이터 디렉터리에 저장되며 **저장소에 커밋하면 안 됩니다**
- 내려받은 음원의 저작권은 권리자에게 있으며, 개인적이고 합법적인 용도로만 사용하십시오

## 의존성

- `@neteasecloudmusicapienhanced/api` — NetEase API(커뮤니티 유지 관리 포크)
- Electron / electron-builder
- ffmpeg(태그와 커버 이미지 기록용, `PATH`에 있어야 함)
