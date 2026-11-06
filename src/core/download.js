#!/usr/bin/env node
/**
 * 网易云音乐歌单批量下载
 * 依赖本地运行的 ncm-api 服务（默认 http://127.0.0.1:3001）
 *
 * 用法:
 *   node download.js <歌单ID|歌单链接|专辑链接|songs.txt> [选项]
 *
 * 选项:
 *   --level <档位>      音质，默认 lossless
 *                        standard(128k) higher(192k) exhigh(320k) lossless(flac)
 *                        hires(Hi-Res) jymaster(超清母带) jyeffect(高清臻音)
 *                        sky(沉浸环绕声) vivid(臻音全景声) dolby(杜比全景声)
 *   --out <目录>        输出目录，默认 ./music
 *   --cookie <字符串>   登录 cookie（MUSIC_U=...），高音质/VIP 必需
 *   --cookie-file <路径> 从文件读 cookie
 *   --concurrency <n>   并发数，默认 4
 *   --limit <n>         只处理前 n 首（调试用）
 *   --no-tag            不写入 ID3 标签和封面
 *   --dry-run           只解析不下载
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');

const API = process.env.NCM_API || 'http://127.0.0.1:3141';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const LEVELS = [
  'standard', 'higher', 'exhigh', 'lossless',
  'hires', 'jymaster', 'jyeffect', 'sky', 'vivid', 'dolby',
];
const opts = {
  level: 'lossless',
  chain: [],
  rulesPath: '',
  out: path.resolve('music'),
  cookie: '',
  concurrency: 4,
  limit: 0,
  tag: true,
  cover: false,
  dryRun: false,
  search: '',
};
let target = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--level') opts.level = next();
  else if (a === '--chain') opts.chain = next().split(/[,>;]/).map((s) => s.trim()).filter(Boolean);
  else if (a === '--rules') opts.rulesPath = path.resolve(next());
  else if (a === '--out') opts.out = path.resolve(next());
  else if (a === '--cookie') opts.cookie = next();
  else if (a === '--cookie-file') opts.cookie = fs.readFileSync(next(), 'utf8').trim();
  else if (a === '--concurrency') opts.concurrency = Math.max(1, parseInt(next(), 10) || 4);
  else if (a === '--limit') opts.limit = Math.max(0, parseInt(next(), 10) || 0);
  else if (a === '--no-tag') opts.tag = false;
  else if (a === '--cover') opts.cover = true;
  else if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--search') { opts.search = next(); }
  else if (!target) target = a;
  else throw new Error('多余参数: ' + a);
}
// --search 把关键词本身当目标
if (opts.search && !target) target = opts.search;
if (!target) {
  console.error('缺少目标。用法: node download.js <歌单ID|链接|songs.txt|歌名> [--search 歌名] [--level sky] [--out 目录]');
  process.exit(2);
}
for (const lv of [opts.level, ...opts.chain]) {
  if (!LEVELS.includes(lv)) {
    console.error('无效音质:', lv, '可选:', LEVELS.join(' '));
    process.exit(2);
  }
}

// 音质回落链：首选 + 备选
const LEVEL_CHAIN = [opts.level, ...opts.chain].filter((v, i, a) => a.indexOf(v) === i);

// 歌手规则：{ "Avicii": { level: "sky", dir: "avicii" } }
let rules = { artists: {} };
if (opts.rulesPath) {
  rules = JSON.parse(fs.readFileSync(opts.rulesPath, 'utf8'));
  rules.artists = rules.artists || {};
}
function matchRule(song) {
  const names = (song.ar || []).map((a) => String(a.name || '').toLowerCase());
  for (const [key, rule] of Object.entries(rules.artists)) {
    const k = key.toLowerCase();
    if (names.some((n) => n === k || n.includes(k))) return rule || {};
  }
  return null;
}
function levelChainFor(song) {
  const rule = matchRule(song);
  if (rule && rule.level && LEVELS.includes(rule.level)) {
    return [rule.level, ...LEVEL_CHAIN.filter((x) => x !== rule.level)];
  }
  return LEVEL_CHAIN;
}
if (process.env.NCM_COOKIE && !opts.cookie) opts.cookie = process.env.NCM_COOKIE;

// ---------- 工具 ----------
function cleanName(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function withCookie(url) {
  if (!opts.cookie) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cookie=${encodeURIComponent(opts.cookie)}`;
}

async function api(pathname, params = {}) {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now() });
  const url = withCookie(`${API}${pathname}?${qs}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}`);
  return res.json();
}

async function retry(fn, times = 3, delay = 800) {
  let lastErr;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < times - 1) await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastErr;
}

function parseTarget(t) {
  // 链接形式
  const m = t.match(/(?:playlist|album|toplist|song)[^]*?[?&]id=(\d+)/i) || t.match(/[?&]id=(\d+)/);
  if (m) {
    if (/\/song\b/.test(t)) return { kind: 'song', id: m[1] };
    return { kind: /album/.test(t) ? 'album' : 'playlist', id: m[1] };
  }
  // 纯数字：显式 --song 当单曲，否则先试歌单、失败再按单曲
  if (/^\d+$/.test(t)) return { kind: 'auto', id: t };
  return { kind: 'file', id: t };
}

async function fetchSong(id) {
  const r = await retry(() => api('/song/detail', { ids: id }));
  const s = (r.songs || [])[0];
  if (!s) throw new Error('找不到歌曲 id=' + id);
  return {
    name: s.name,
    creator: (s.ar || []).map((a) => a.name).join(', '),
    songs: [s],
    cover: s.al?.picUrl || '',
  };
}

// ---------- 解析曲目 ----------
async function fetchPlaylist(id) {
  const detail = await retry(() => api('/playlist/detail', { id }));
  if (detail.code !== 200) throw new Error('playlist/detail 失败: ' + JSON.stringify(detail).slice(0, 200));
  const meta = detail.playlist;
  const total = meta.trackCount;
  const songs = [];
  const pageSize = 500;
  for (let offset = 0; offset < total; offset += pageSize) {
    const r = await retry(() => api('/playlist/track/all', { id, limit: pageSize, offset }));
    if (r.code !== 200 || !Array.isArray(r.songs)) break;
    songs.push(...r.songs);
    if (r.songs.length < pageSize) break;
  }
  return { name: meta.name, creator: meta.creator?.nickname || '', songs, cover: meta.coverImgUrl || '' };
}

async function fetchAlbum(id) {
  // 必须带 s 参数才会返回曲目列表；曲目在顶层 r.songs，不是 album.songs
  const r = await retry(() => api('/album', { id, s: 1000 }));
  const al = r.album;
  if (!al) throw new Error('album 接口无数据: ' + JSON.stringify(r).slice(0, 200));
  const songs = (r.songs && r.songs.length ? r.songs : al.songs) || [];
  if (!songs.length) throw new Error('专辑「' + al.name + '」没有取到曲目（可能全部下架）');
  return { name: al.name, creator: al.artist?.name || '', songs, cover: al.picUrl || '' };
}

// 按歌名（可带歌手）搜索，返回候选列表
async function searchSongs(keyword, limit = 20) {
  const r = await retry(() => api('/search', { keywords: keyword, type: 1, limit }));
  const list = r.result?.songs || [];
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    artists: (s.artists || s.ar || []).map((a) => a.name),
    album: s.album?.name || s.al?.name || '',
    duration: s.duration || s.dt || 0,
  }));
}

function readSongsFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const ids = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)/);
    if (m) ids.push({ id: Number(m[1]), name: '', ar: [], al: {} });
  }
  return ids;
}

// ---------- 下载单个 ----------
const stats = { ok: 0, skip: 0, fail: 0, trial: 0, total: 0 };
let downgradeWarned = false;
let stopped = false;

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}
const failed = [];

function extOf(type) {
  if (type === 'flac') return 'flac';
  if (type === 'aac') return 'm4a';
  if (type === 'mp4') return 'mp4';
  return 'mp3';
}

async function resolveUrl(song) {
  // 按回落链逐档请求，命中真实档位才采用
  const chain = levelChainFor(song);
  let last = null;
  for (const lv of chain) {
    let info;
    try {
      const r = await retry(() => api('/song/url/v1', { id: song.id, level: lv }));
      info = r.data?.[0];
    } catch {
      continue;
    }
    if (!info || !info.url) continue;
    last = info;
    const losslessClass = ['lossless', 'hires', 'jymaster', 'jyeffect', 'sky', 'vivid', 'dolby'].includes(lv);
    const hit = info.level === lv && (!losslessClass || info.type === 'flac');
    if (hit) return { info, level: lv, degraded: false, requested: lv };
  }
  if (last) return { info: last, level: last.level, degraded: true, requested: chain[0] };
  return null;
}

async function downloadOne(song, index, pad, dir, coverUrl) {
  const name = song.name || `unknown-${song.id}`;
  const artist = (song.ar || []).map((a) => a.name).join(', ') || '未知歌手';
  const rule = matchRule(song);
  // 规则指定的歌手目录放 --out 根下，与歌单目录并列
  let outDir = dir;
  if (rule && rule.dir) {
    outDir = path.join(opts.out, cleanName(rule.dir));
    fs.mkdirSync(outDir, { recursive: true });
  }
  // 磁盘保护：剩余不足 1.5GB 停止
  if (freeBytes(outDir) < 1.5 * 1024 ** 3) {
    if (!stopped) {
      stopped = true;
      console.log('  [停止] 剩余空间不足 1.5GB，已中止后续下载');
    }
    return;
  }
  const prefix = String(index + 1).padStart(pad, '0');
  let base = cleanName(`${prefix} ${artist} - ${name}`);

  const got = await resolveUrl(song);
  if (!got) {
    stats.fail++;
    // 区分「下架」与「需登录」：st === -1 或无 fee 信息一般是下架/无版权
    const offline = song.st === -1;
    const reason = offline ? '已下架或无版权' : '无可用链接（可能需要登录 cookie）';
    failed.push(`${name}: ${reason}`);
    console.log(`  [FAIL] ${name}: ${reason}`);
    return;
  }
  const info = got.info;
  if (info.freeTrialInfo) {
    // 试听片段，不完整
    stats.trial++;
    failed.push(`${name}: 仅试听片段（VIP 曲目，需 --cookie）`);
    return;
  }
  if (got.degraded && !downgradeWarned) {
    downgradeWarned = true;
    console.log(`  [注意] ${got.requested} 未命中，服务端实际返回 ${info.level} ${extOf(info.type)} ${Math.round((info.br || 0) / 1000)}kbps，可能无对应权限或该曲无此版本`);
  }

  const ext = extOf(info.type);
  const file = path.join(outDir, `${base}.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10240) {
    stats.skip++;
    return;
  }

  const tmp = file + '.part';
  try {
    const cover = opts.tag && opts.cover ? await fetchCover(song, coverUrl, outDir) : null;
    const res = await fetch(info.url, {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    const size = fs.statSync(tmp).size;
    if (size < 10240) throw new Error('文件过小: ' + size);

    if (opts.tag) {
      try {
        await tagFile(tmp, file, song, cover);
      } catch {
        try { fs.unlinkSync(file); } catch {}
        fs.renameSync(tmp, file);
      }
    } else {
      fs.renameSync(tmp, file);
    }
    if (cover) { try { fs.unlinkSync(cover); } catch {} }
    stats.ok++;
    console.log(`  [OK] ${base}.${ext}  (${got.level}${got.degraded ? ' 降级' : ''})`);
  } catch (e) {
    stats.fail++;
    failed.push(`${name}: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    console.log(`  [FAIL] ${name}: ${e.message}`);
  }
}

async function fetchCover(song, fallback, dir) {
  const url = (song.al?.picUrl || fallback || '').replace(/^http:/, 'https:');
  if (!url) return null;
  const file = path.join(dir, `.cover-${song.id}.tmp.jpg`);
  try {
    const res = await fetch(url + '?param=800y800', { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
    return fs.statSync(file).size > 1024 ? file : null;
  } catch {
    return null;
  }
}

function tagFile(tmp, out, song, cover) {
  const artist = (song.ar || []).map((a) => a.name).join('/');
  const isMp3 = /\.mp3$/i.test(out);
  const args = ['-y', '-loglevel', 'error', '-i', tmp];
  if (cover) args.push('-i', cover);
  args.push('-map', '0:a', '-c', 'copy');
  if (cover) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v', 'comment=Cover (front)');
  args.push(
    '-metadata', `title=${song.name || ''}`,
    '-metadata', `artist=${artist}`,
    '-metadata', `album=${song.al?.name || ''}`,
    '-metadata', `track=${song.no || ''}`,
    '-metadata', 'comment=downloaded via ncm-api'
  );
  if (isMp3) args.push('-id3v2_version', '3');
  args.push(out);
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg ' + code + ' ' + err.slice(0, 200)));
      try { fs.unlinkSync(tmp); } catch {}
      resolve();
    });
  });
}

// ---------- 主流程 ----------
(async () => {
  let ctx;
  // 歌名搜索模式：不在上面的任何 id/链接分支里
  if (opts.search) {
    const kw = opts.search;
    console.log(`搜索: ${kw}`);
    const hits = await searchSongs(kw, opts.limit || 20);
    if (!hits.length) {
      console.log('没搜到结果。');
      return;
    }
    hits.forEach((h, i) => {
      const dur = h.duration ? Math.floor(h.duration / 1000) + 's' : '';
      console.log(`  ${i + 1}. ${h.name} - ${h.artists.join(', ')} @${h.album} ${dur}`);
    });
    ctx = {
      name: '搜索-' + cleanName(kw),
      creator: '搜索结果',
      songs: hits.map((h) => ({ id: h.id, name: h.name, ar: h.artists.map((n) => ({ name: n })), al: { name: h.album } })),
      cover: '',
    };
    // 用搜索结果继续走下面的下载流程
  }

  const t = ctx ? null : parseTarget(target);
  if (!ctx) {
  if (t.kind === 'file') {
    if (!fs.existsSync(t.id)) throw new Error('文件不存在: ' + t.id);
    ctx = { name: path.basename(t.id, path.extname(t.id)), creator: '', songs: readSongsFile(t.id), cover: '' };
    // 补全曲名
    const ids = ctx.songs.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 200) {
      const r = await api('/song/detail', { ids: ids.slice(i, i + 200).join(',') });
      for (const s of r.songs || []) {
        const slot = ctx.songs.find((x) => x.id === s.id);
        if (slot) Object.assign(slot, s);
      }
    }
  } else if (t.kind === 'album') {
    ctx = await fetchAlbum(t.id);
  } else if (t.kind === 'song') {
    ctx = await fetchSong(t.id);
  } else if (t.kind === 'auto') {
    // 纯数字：先按歌单查，查不到再当单曲
    try {
      const pl = await fetchPlaylist(t.id);
      if (pl.songs && pl.songs.length) ctx = pl;
    } catch {}
    if (!ctx) {
      try {
        ctx = await fetchSong(t.id);
        console.log('（id 不是歌单，已按单曲处理）');
      } catch {
        ctx = await fetchPlaylist(t.id);
      }
    }
  } else {
    ctx = await fetchPlaylist(t.id);
  }
  }

  if (opts.limit > 0) ctx.songs = ctx.songs.slice(0, opts.limit);

  console.log(`歌单: ${ctx.name}${ctx.creator ? ' / ' + ctx.creator : ''}`);
  console.log(`曲目: ${ctx.songs.length} 首 | 音质: ${opts.level} | 并发: ${opts.concurrency}`);
  stats.total = ctx.songs.length;
  if (opts.dryRun) {
    ctx.songs.slice(0, 20).forEach((s, i) => console.log(`  ${i + 1}. ${s.name} - ${(s.ar || []).map((a) => a.name).join(',')}`));
    return;
  }

  // 清单文件直接放 --out 根目录，歌单/专辑/搜索才建子目录
  const dir = t && t.kind === 'file' ? opts.out : path.join(opts.out, cleanName(ctx.name));
  fs.mkdirSync(dir, { recursive: true });
  console.log(`输出: ${dir}`);
  console.log(`音质链: ${LEVEL_CHAIN.join(' -> ')}` + (Object.keys(rules.artists).length ? ` | 歌手规则: ${JSON.stringify(rules.artists)}` : ''));

  const pad = String(ctx.songs.length).length;

  // 简单并发池
  let cursor = 0;
  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (!stopped && cursor < ctx.songs.length) {
      const i = cursor++;
      await downloadOne(ctx.songs[i], i, pad, dir, ctx.songs[i].al?.picUrl || ctx.cover);
    }
  });
  await Promise.all(workers);

  fs.writeFileSync(
    path.join(dir, '_result.json'),
    JSON.stringify({ playlist: ctx.name, time: new Date().toISOString(), levelChain: LEVEL_CHAIN, rules: rules.artists, stats, failed }, null, 2)
  );

  console.log('\n===== 汇总 =====');
  console.log(`成功 ${stats.ok} | 跳过(已存在) ${stats.skip} | 失败 ${stats.fail} | 试听未下 ${stats.trial} | 共 ${stats.total}`);
  if (failed.length) {
    console.log('失败明细:');
    failed.slice(0, 40).forEach((f) => console.log('  - ' + f));
  }
})().catch((e) => {
  console.error('错误:', e.message);
  process.exit(1);
});
