'use strict';

const $ = (id) => document.getElementById(id);

let state = {
  fileTarget: '',
  searchTarget: '',
  running: false,
  stats: { ok: 0, skip: 0, fail: 0, trial: 0, total: 0 },
  qrTimer: null,
};

// ---------- 日志 ----------
function log(line, cls) {
  const el = $('log');
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  const span = document.createElement('div');
  if (cls) span.className = cls;
  else if (line.startsWith('  [OK]')) span.className = 'ok';
  else if (line.startsWith('  [FAIL]')) span.className = 'fail';
  else if (/降级|\[注意\]|\[停止\]|警告/.test(line)) span.className = 'warn';
  span.textContent = line;
  el.appendChild(span);
  while (el.childElementCount > 3000) el.removeChild(el.firstChild);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function renderStats(s) {
  state.stats = s;
  $('stTotal').textContent = s.total || 0;
  $('stOk').textContent = s.ok || 0;
  $('stSkip').textContent = s.skip || 0;
  $('stFail').textContent = s.fail || 0;
  $('stTrial').textContent = s.trial || 0;
  const done = (s.ok || 0) + (s.skip || 0) + (s.fail || 0) + (s.trial || 0);
  const pct = s.total > 0 ? Math.min(100, Math.round((done / s.total) * 100)) : 0;
  $('bar').style.width = pct + '%';
}

// ---------- 初始化 ----------
async function init() {
  const info = await window.api.info();
  $('out').value = info.config.out || '';
  $('level').value = info.config.level || 'sky';
  $('concurrency').value = info.config.concurrency || 4;
  $('apiBadge').textContent = 'API 就绪 ' + info.apiBase.replace('http://', '');
  $('apiBadge').className = 'badge badge-on';
  setLoginBadge(info.hasCookie);
  log(`就绪 | 版本 ${info.version}`);
  log(`输出目录 ${info.config.out}`);
  log(`内置 API ${info.apiBase}`);
  if (!info.hasCookie) log('[注意] 未保存 cookie，VIP / 无损曲目会拿到试听片段', 'warn');
  const st = await window.api.state();
  if (st.running) setRunning(true);
  // 启动后自动检查一次更新（失败不打扰）
  checkUpdate(true);
}

// ---------- 版本更新 ----------
let lastUpdateData = null;

async function checkUpdate(silent) {
  const badge = $('verBadge');
  if (!silent) {
    badge.textContent = '检查中…';
    badge.className = 'badge badge-off';
  }
  const r = await window.api.checkUpdate();
  if (!r.ok) {
    badge.textContent = 'v' + (r.current || '?') + ' 检查失败';
    badge.className = 'badge badge-off';
    badge.title = r.message || '';
    if (!silent) log('[更新] 检查失败: ' + r.message, 'warn');
    return;
  }
  const d = r.data;
  lastUpdateData = d;
  if (d.hasUpdate) {
    badge.textContent = `v${d.current} → ${d.latestTag}`;
    badge.className = 'badge badge-warn';
    badge.title = '有新版本，点击打开发布页';
    log(`[更新] 发现新版本 ${d.latestTag}（当前 v${d.current}），点右上角版本号打开发布页`, 'warn');
  } else {
    badge.textContent = `v${d.current} 已是最新`;
    badge.className = 'badge badge-on';
    badge.title = `最新 ${d.latestTag}（检查时间 ${new Date(d.checkedAt).toLocaleString()}）`;
    log(`[更新] 已是最新版本 v${d.current}（远程 ${d.latestTag}）`, 'ok');
  }
}

function setLoginBadge(has) {
  const b = $('loginBadge');
  b.textContent = has ? '已登录' : '未登录';
  b.className = 'badge ' + (has ? 'badge-on' : 'badge-warn');
}

function setRunning(v) {
  state.running = v;
  $('btnStart').disabled = v;
  $('btnStop').disabled = !v;
  $('btnPreview').disabled = v;
}

// ---------- 来源 ----------
function renderPreview(d, sourceLabel) {
  $('plName').textContent = d.name || '(无标题)';
  $('plMeta').textContent = `${d.creator || ''} · 共 ${d.count} 首`;
  const ol = $('plSongs');
  ol.innerHTML = '';
  (d.songs || []).slice(0, 300).forEach((s) => {
    const li = document.createElement('li');
    const alb = s.album ? ` · ${s.album}` : '';
    li.textContent = `${s.name} - ${(s.artists || []).join(', ')}${alb}`;
    ol.appendChild(li);
  });
  if ((d.songs || []).length > 300) {
    const li = document.createElement('li');
    li.textContent = `…… 其余 ${d.songs.length - 300} 首未列出`;
    ol.appendChild(li);
  }
  $('previewBox').classList.remove('hidden');
  log(`[${sourceLabel}] ${d.name} · ${d.count} 首`, 'ok');
}

async function doPreview(target) {
  if (!target) return log('[注意] 请先填写链接或选择清单文件', 'warn');
  log('解析中: ' + target);
  const r = await window.api.preview(target);
  if (!r.ok) {
    log('[FAIL] 解析失败: ' + r.message, 'fail');
    return;
  }
  renderPreview(r.data, '解析成功');
}

async function doSearch(kw) {
  if (!kw) return log('[注意] 请输入歌名', 'warn');
  log('搜索中: ' + kw);
  const r = await window.api.search(kw);
  if (!r.ok) {
    log('[FAIL] 搜索失败: ' + r.message, 'fail');
    return;
  }
  renderPreview(r.data, '搜索成功');
}

// ---------- 事件 ----------
$('verBadge').addEventListener('click', async () => {
  const d = lastUpdateData;
  if (d && d.hasUpdate) {
    log('[更新] 打开发布页: ' + d.pageUrl);
    await window.api.openReleasePage(d.pageUrl);
  } else {
    await checkUpdate(false);
  }
});

$('btnPreview').addEventListener('click', () => {
  state.fileTarget = '';
  state.searchTarget = '';
  $('fileName').textContent = '未选择';
  doPreview($('target').value.trim());
});
$('target').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnPreview').click();
});

$('btnSearch').addEventListener('click', () => {
  state.fileTarget = '';
  const kwEl = $('searchKw');
  state.searchTarget = kwEl ? kwEl.value.trim() : '';
  $('fileName').textContent = '未选择';
  $('target').value = '';
  doSearch(state.searchTarget);
});
$('searchKw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnSearch').click();
});

$('btnPickFile').addEventListener('click', async () => {
  const p = await window.api.pickFile();
  if (!p) return;
  state.fileTarget = p;
  $('fileName').textContent = p;
  $('target').value = '';
  doPreview(p);
});

$('btnPickOut').addEventListener('click', async () => {
  const p = await window.api.pickOut();
  if (!p) return;
  $('out').value = p;
  await window.api.saveConfig({ out: p });
});

$('btnOpenOut').addEventListener('click', () => {
  window.api.openOut($('out').value.trim());
});

$('level').addEventListener('change', () => window.api.saveConfig({ level: $('level').value }));
$('concurrency').addEventListener('change', () =>
  window.api.saveConfig({ concurrency: Number($('concurrency').value) || 4 })
);

// 防止滚轮误改数字/下拉框的值
for (const id of ['concurrency', 'limit', 'level']) {
  $(id).addEventListener('wheel', (e) => e.target.blur(), { passive: true });
}

$('btnStart').addEventListener('click', async () => {
  const target = state.fileTarget || $('target').value.trim();
  const search = state.searchTarget || '';
  if (!target && !search) return log('[注意] 请先填写链接、搜索歌名或选择清单文件', 'warn');
  const out = $('out').value.trim();
  if (!out) return log('[注意] 请选择输出目录', 'warn');

  const chain = $('chain').value
    .split(/[,>;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  await window.api.saveConfig({
    out,
    level: $('level').value,
    concurrency: Number($('concurrency').value) || 4,
  });

  log('----------------------------------------');
  log(search ? '开始下载（歌名搜索）: ' + search : '开始下载: ' + target);
  const r = await window.api.start({
    target: search ? '' : target,
    search,
    level: $('level').value,
    chain,
    out,
    concurrency: Number($('concurrency').value) || 4,
    limit: Number($('limit').value) || 0,
  });
  if (!r.ok) {
    log('[FAIL] 启动失败: ' + r.message, 'fail');
    return;
  }
  renderStats({ ok: 0, skip: 0, fail: 0, trial: 0, total: 0 });
  setRunning(true);
});

$('btnStop').addEventListener('click', async () => {
  const r = await window.api.stop();
  log(r.ok ? '[已请求停止]' : '[注意] ' + r.message, 'warn');
});

window.api.onLog((line) => log(line));
window.api.onStats((s) => renderStats(s));
window.api.onDone((d) => {
  setRunning(false);
  const timed = d.code === 0 ? '' : `（退出码 ${d.code}）`;
  log('========================================');
  log(`任务结束${timed}：成功 ${d.stats?.ok || 0} | 跳过 ${d.stats?.skip || 0} | 失败 ${d.stats?.fail || 0} | 试听未下 ${d.stats?.trial || 0}`,
    d.code === 0 ? 'ok' : 'warn');
  renderStats(d.stats || state.stats);
});

// ---------- 登录 ----------
$('btnLogin').addEventListener('click', () => {
  $('modal').classList.remove('hidden');
  $('cookieStatus').textContent = '';
});
$('btnModalClose').addEventListener('click', () => {
  $('modal').classList.add('hidden');
  if (state.qrTimer) {
    clearInterval(state.qrTimer);
    state.qrTimer = null;
  }
});

$('btnSaveCookie').addEventListener('click', async () => {
  const v = $('cookieInput').value.trim();
  const r = await window.api.saveCookie(v);
  $('cookieStatus').textContent = r.hasCookie ? '已保存' : '已清空';
  setLoginBadge(r.hasCookie);
  log(r.hasCookie ? '[登录态] cookie 已保存' : '[登录态] cookie 已清空');
});

$('btnCheckLogin').addEventListener('click', async () => {
  $('cookieStatus').textContent = '检查中…';
  const r = await window.api.checkLogin();
  if (!r.ok) {
    $('cookieStatus').textContent = r.message;
    return;
  }
  const d = r.data || {};
  const prof = d.profile || d.data?.profile;
  if (prof) {
    $('cookieStatus').textContent = `已登录：${prof.nickname} (uid ${prof.userId})`;
    setLoginBadge(true);
    log(`[登录态] ${prof.nickname} (uid ${prof.userId})`);
  } else {
    $('cookieStatus').textContent = '未登录或已过期';
    setLoginBadge(false);
  }
});

$('btnQr').addEventListener('click', async () => {
  $('qrStatus').textContent = '生成中…';
  try {
    const r = await window.api.qr();
    $('qrImg').src = r.qrimg;
    $('qrBox').classList.remove('hidden');
    $('qrStatus').textContent = '用网易云音乐 App 扫码';
    if (state.qrTimer) clearInterval(state.qrTimer);
    state.qrTimer = setInterval(async () => {
      const c = await window.api.qrCheck(r.unikey);
      if (c.code === 800) {
        $('qrStatus').textContent = '二维码已过期，请重新生成';
        clearInterval(state.qrTimer);
        state.qrTimer = null;
      } else if (c.code === 801) {
        $('qrStatus').textContent = '等待扫码…';
      } else if (c.code === 802) {
        $('qrStatus').textContent = '已扫码，请在手机确认';
      } else if (c.code === 803) {
        $('qrStatus').textContent = '登录成功';
        setLoginBadge(true);
        log('[登录态] 扫码登录成功');
        clearInterval(state.qrTimer);
        state.qrTimer = null;
      }
    }, 2000);
  } catch (e) {
    $('qrStatus').textContent = '生成失败: ' + e.message;
  }
});

init().catch((e) => log('[FAIL] 初始化失败: ' + e.message, 'fail'));
