'use strict';
/**
 * Electron 主进程
 * - 内置网易云 API 服务（在 Electron 的 Node 运行时里直接 require，不另起进程）
 * - 用 fork 起 download.js 子进程做下载，实时回传进度
 * - 配置与登录态存在用户数据目录
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork, execFile } = require('child_process');

const CORE_DIR = path.join(__dirname, '..', 'core');
const API_PORT = 3141;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const LEVELS = [
  'standard', 'higher', 'exhigh', 'lossless',
  'hires', 'jymaster', 'jyeffect', 'sky', 'vivid', 'dolby',
];

let win = null;
let apiServer = null;
let currentChild = null;
let currentRun = null;

// ---------- 用户数据 ----------
function userDir() {
  const d = app.getPath('userData');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function configPath() {
  return path.join(userDir(), 'config.json');
}
function cookiePath() {
  return path.join(userDir(), 'cookie.txt');
}

function loadConfig() {
  const defaults = {
    out: path.join(app.getPath('music') || app.getPath('downloads'), 'NCM'),
    level: 'sky',
    concurrency: 4,
    ffmpeg: '',
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return defaults;
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
function readCookie() {
  for (const p of [cookiePath(), path.join(CORE_DIR, 'cookie.txt')]) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    } catch {}
  }
  return '';
}
function writeCookie(v) {
  fs.writeFileSync(cookiePath(), v.trim());
}

// ---------- 内置 API ----------
async function startApi() {
  if (apiServer) return API_BASE;
  process.env.PORT = String(API_PORT);
  const entry = path.join(
    app.getAppPath(),
    'node_modules',
    '@neteasecloudmusicapienhanced',
    'api',
    'app.js'
  );
  if (!fs.existsSync(entry)) throw new Error('找不到内置 API 服务: ' + entry);
  // API 是 express 应用，直接在当前进程监听，省掉 fork
  apiServer = require(entry);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`API 服务 ${API_PORT} 端口启动超时`)),
      20000
    );
    apiServer.once('listening', () => {
      clearTimeout(timer);
      resolve();
    });
    apiServer.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return API_BASE;
}

async function apiGet(pathname, params = {}) {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now() });
  const res = await fetch(`${API_BASE}${pathname}?${qs}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 MusicDownloaderGUI' },
  });
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}`);
  return res.json();
}

// ---------- 歌单预览 ----------
function parseTarget(t) {
  const m =
    t.match(/(?:playlist|album|toplist)[^]*?[?&]id=(\d+)/i) || t.match(/[?&]id=(\d+)/);
  if (m) return { kind: /album/.test(t) ? 'album' : 'playlist', id: m[1] };
  if (/^\d+$/.test(t)) return { kind: 'playlist', id: t };
  return { kind: 'file', id: t };
}

async function previewPlaylist(target) {
  const t = parseTarget(String(target || '').trim());
  if (t.kind === 'file') {
    const lines = fs
      .readFileSync(t.id, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ids = [];
    for (const line of lines) {
      const m = line.match(/^(\d+)/);
      if (m) ids.push(Number(m[1]));
    }
    const songs = [];
    for (let i = 0; i < ids.length; i += 200) {
      const r = await apiGet('/song/detail', { ids: ids.slice(i, i + 200).join(',') });
      (r.songs || []).forEach((s) =>
        songs.push({ name: s.name, artists: (s.ar || []).map((a) => a.name) })
      );
    }
    return { kind: 'file', name: path.basename(t.id, path.extname(t.id)), count: songs.length, songs };
  }
  if (t.kind === 'album') {
    const r = await apiGet('/album', { id: t.id });
    const al = r.album || {};
    return {
      kind: 'album',
      name: al.name || '',
      creator: al.artist?.name || '',
      count: (al.songs || []).length,
      songs: (al.songs || []).map((s) => ({
        name: s.name,
        artists: (s.ar || []).map((a) => a.name),
      })),
    };
  }
  const d = await apiGet('/playlist/detail', { id: t.id });
  const pl = d.playlist || {};
  const total = pl.trackCount || 0;
  const songs = [];
  for (let offset = 0; offset < Math.min(total, 2000); offset += 500) {
    const r = await apiGet('/playlist/track/all', { id: t.id, limit: 500, offset });
    if (!Array.isArray(r.songs)) break;
    r.songs.forEach((s) =>
      songs.push({ name: s.name, artists: (s.ar || []).map((a) => a.name) })
    );
    if (r.songs.length < 500) break;
  }
  return {
    kind: 'playlist',
    name: pl.name || '',
    creator: pl.creator?.nickname || '',
    count: total,
    songs,
  };
}

// ---------- 下载进程 ----------
function resolveFfmpeg(cfg) {
  if (cfg.ffmpeg && fs.existsSync(cfg.ffmpeg)) return cfg.ffmpeg;
  return 'ffmpeg'; // 交给 PATH
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function buildArgs(job) {
  const cfg = loadConfig();
  const args = [job.target];
  if (job.level && LEVELS.includes(job.level)) args.push('--level', job.level);
  if (job.chain && job.chain.length) args.push('--chain', job.chain.join(','));
  if (job.out) args.push('--out', job.out);
  if (job.limit > 0) args.push('--limit', String(job.limit));
  args.push('--concurrency', String(job.concurrency || cfg.concurrency || 4));
  args.push('--cover');
  const rules = path.join(CORE_DIR, 'rules.json');
  if (fs.existsSync(rules)) args.push('--rules', rules);
  const cookie = readCookie();
  if (cookie) args.push('--cookie', cookie);
  return args;
}

async function startDownload(job) {
  if (currentChild) throw new Error('已有下载任务在运行');
  await startApi();
  const args = buildArgs(job);
  const ffmpeg = resolveFfmpeg(loadConfig());
  const env = { ...process.env, NCM_API: API_BASE };
  const ffDir = path.dirname(ffmpeg);
  if (ffDir && ffDir !== '.' && fs.existsSync(ffDir)) {
    env.PATH = ffDir + path.delimiter + (env.PATH || '');
  }
  const child = fork(path.join(CORE_DIR, 'download.js'), args, {
    cwd: CORE_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  currentChild = child;
  currentRun = {
    startedAt: Date.now(),
    target: job.target,
    out: job.out,
    level: job.level,
    stats: { ok: 0, skip: 0, fail: 0, trial: 0, total: 0 },
    lines: [],
  };
  const onData = (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      currentRun.lines.push(line);
      if (currentRun.lines.length > 5000) currentRun.lines.shift();
      send('dl:log', line);
      const m = line.match(/^曲目: (\d+) 首/);
      if (m) currentRun.stats.total = Number(m[1]);
      if (line.startsWith('  [OK]')) currentRun.stats.ok++;
      if (line.startsWith('  [FAIL]')) {
        if (/试听/.test(line)) currentRun.stats.trial++;
        else currentRun.stats.fail++;
      }
      send('dl:stats', currentRun.stats);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', (d) => {
    const line = d.toString('utf8').trimEnd();
    if (line) {
      currentRun.lines.push('[stderr] ' + line);
      send('dl:log', line);
    }
  });
  child.on('exit', (code) => {
    send('dl:done', { code, stats: currentRun?.stats });
    if (currentChild === child) currentChild = null;
  });
  return { ok: true, pid: child.pid, args };
}

function stopDownload() {
  if (!currentChild) return { ok: false, message: '没有正在运行的任务' };
  currentChild.kill();
  return { ok: true };
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#12151c',
    title: '网易云歌单批量下载器',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- IPC ----------
ipcMain.handle('app:info', async () => ({
  apiBase: API_BASE,
  coreDir: CORE_DIR,
  userDir: userDir(),
  levels: LEVELS,
  hasCookie: !!readCookie(),
  ffmpeg: resolveFfmpeg(loadConfig()),
  config: loadConfig(),
  version: app.getVersion(),
}));

ipcMain.handle('cfg:save', async (_e, patch) => {
  const cfg = { ...loadConfig(), ...patch };
  saveConfig(cfg);
  return cfg;
});

ipcMain.handle('cfg:pickOut', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('cfg:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '曲目清单', extensions: ['txt'] }, { name: '全部', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('cfg:pickFfmpeg', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pl:preview', async (_e, target) => {
  try {
    await startApi();
    return { ok: true, data: await previewPlaylist(target) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('dl:start', async (_e, job) => {
  try {
    return await startDownload(job);
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('dl:stop', async () => stopDownload());

ipcMain.handle('dl:state', async () => ({
  running: !!currentChild,
  run: currentRun,
}));

ipcMain.handle('dl:openOut', async (_e, dir) => {
  if (dir && fs.existsSync(dir)) shell.openPath(dir);
});

ipcMain.handle('auth:saveCookie', async (_e, cookie) => {
  writeCookie(cookie || '');
  return { ok: true, hasCookie: !!readCookie() };
});

ipcMain.handle('auth:check', async () => {
  try {
    await startApi();
    const cookie = readCookie();
    if (!cookie) return { ok: false, message: '未保存 cookie' };
    const r = await apiGet('/login/status', { cookie });
    return { ok: true, data: r?.data || r };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// 扫码登录：调用 API 的 qr 接口
ipcMain.handle('auth:qr', async () => {
  await startApi();
  const key = await apiGet('/login/qr/key');
  const unikey = key?.data?.unikey;
  if (!unikey) throw new Error('获取二维码 key 失败');
  const img = await apiGet('/login/qr/create', { key: unikey, qrimg: true });
  return { unikey, qrimg: img?.data?.qrimg || '' };
});

ipcMain.handle('auth:qrCheck', async (_e, unikey) => {
  const r = await apiGet('/login/qr/check', { key: unikey });
  if (r.code === 803 && r.cookie) {
    writeCookie(r.cookie);
    return { code: 803, message: '登录成功', loggedIn: true };
  }
  return { code: r.code, message: r.message || '' };
});

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  createWindow();
  try {
    await startApi();
  } catch (e) {
    send('dl:log', '[警告] 内置 API 服务启动失败: ' + e.message);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (currentChild) currentChild.kill();
  app.quit();
});

app.on('before-quit', () => {
  if (currentChild) currentChild.kill();
});
