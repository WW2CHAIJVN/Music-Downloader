#!/usr/bin/env node
/**
 * 把 "歌名 - 歌手" 清单解析成网易云歌曲 ID
 * 用法: node match.js songs.txt [--out songs.json] [--limit n] [--concurrency 3]
 */
const fs = require('fs');
const path = require('path');
const API = process.env.NCM_API || 'http://127.0.0.1:3001';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const argv = process.argv.slice(2);
const file = argv[0];
const outJson = (() => {
  const i = argv.indexOf('--out');
  return i > -1 ? path.resolve(argv[i + 1]) : path.resolve('songs.json');
})();
const limitArg = (() => {
  const i = argv.indexOf('--limit');
  return i > -1 ? parseInt(argv[i + 1], 10) : 0;
})();
const conc = (() => {
  const i = argv.indexOf('--concurrency');
  return i > -1 ? Math.max(1, parseInt(argv[i + 1], 10) || 3) : 3;
})();

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(feat[^)]*\)/g, '')
    .replace(/（feat[^）]*）/g, '')
    .replace(/[\[\]【】()（）\-_.,!?'"`~·:;/\\|&+*=]/g, '')
    .replace(/\s+/g, '')
    .trim();
}
function splitArtists(s) {
  return String(s || '')
    .split(/\s*[\/,&、]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const items = [];
for (const line of lines) {
  const idx = line.lastIndexOf(' - ');
  if (idx < 1) { items.push({ line, name: line, artists: [], ok: false, reason: 'no separator' }); continue; }
  items.push({ line, name: line.slice(0, idx).trim(), artists: splitArtists(line.slice(idx + 3).trim()), ok: false });
}
const list = limitArg > 0 ? items.slice(0, limitArg) : items;
console.log(`解析 ${list.length} 行`);

async function api(p, params) {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now() });
  const res = await fetch(`${API}${p}?${qs}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (j.code !== 200) throw new Error('code ' + j.code);
  return j;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function score(song, item) {
  const sn = norm(song.name);
  const tn = norm(item.name);
  let s = 0;
  if (sn === tn) s += 50;
  else if (sn.includes(tn) || tn.includes(sn)) s += 25;
  const songArtists = (song.artists || []).map((a) => norm(a.name));
  const targetArtists = item.artists.map(norm);
  for (const t of targetArtists) {
    if (!t) continue;
    if (songArtists.some((a) => a === t)) s += 30;
    else if (songArtists.some((a) => a.includes(t) || t.includes(a))) s += 15;
  }
  if ((song.album || {}).name && norm(song.album.name).includes(tn)) s += 5;
  return s;
}

async function matchOne(item) {
  const kw = `${item.name} ${item.artists[0] || ''}`.trim();
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      r = await api('/search', { keywords: kw, type: 1, limit: 15 });
      break;
    } catch (e) {
      if (attempt === 2) return { ...item, ok: false, reason: e.message };
      await sleep(1500 * (attempt + 1));
    }
  }
  const songs = r.result?.songs || [];
  if (!songs.length) {
    // 退一步只用歌名搜
    try {
      const r2 = await api('/search', { keywords: item.name, type: 1, limit: 15 });
      songs.push(...(r2.result?.songs || []));
    } catch {}
  }
  if (!songs.length) return { ...item, ok: false, reason: 'no result' };
  let best = null, bestScore = -1;
  for (const s of songs) {
    const sc = score(s, item);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return {
    ...item,
    ok: bestScore >= 45,
    score: bestScore,
    id: best?.id,
    found: best?.name,
    foundArtists: (best?.artists || []).map((a) => a.name).join(', '),
    album: best?.album?.name || '',
    reason: bestScore >= 45 ? '' : 'low confidence',
  };
}

(async () => {
  const results = new Array(list.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (cursor < list.length) {
      const i = cursor++;
      results[i] = await matchOne(list[i]);
      done++;
      if (done % 25 === 0 || done === list.length) {
        process.stdout.write(`  已匹配 ${done}/${list.length}\n`);
      }
      await sleep(150);
    }
  });
  await Promise.all(workers);

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  fs.writeFileSync(outJson, JSON.stringify({ total: results.length, matched: ok.length, items: results }, null, 2));
  fs.writeFileSync(
    outJson.replace(/\.json$/, '') + '-unmatched.txt',
    bad.map((b) => `${b.line}\t=> ${b.found || ''} / ${b.foundArtists || ''} (${b.reason})`).join('\n')
  );
  console.log(`\n匹配成功 ${ok.length} / ${results.length}，未匹配 ${bad.length}`);
  console.log('结果: ' + outJson);
  console.log('未匹配: ' + outJson.replace(/\.json$/, '') + '-unmatched.txt');
})().catch((e) => { console.error(e); process.exit(1); });
