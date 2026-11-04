'use strict';

const $ = (id) => document.getElementById(id);

let state = {
  fileTarget: '',
  running: false,
  stats: { ok: 0, skip: 0, fail: 0, trial: 0, total: 0 },
  qrTimer: null,
};

// ---------------------------------------------------------------------------
// imeGuard —— 输入法组字保护
//
// 本机插件 ime-composer-guard 兜住的是 contenteditable 的 contentEditable
// 属性写入：组字期间写它，Chromium 会取消正在进行的组字，把拼音缓冲提前提交，
// nihao 落成「泥嚎」或者就是裸字母。
//
// 本应用没有 contenteditable，但同一套时序规则套在「程序写控件」上一样成立：
// 用户在输入框里打到一半，程序把 value / disabled 改了，组字同样会被打断。
// 这里只在组字期间挂起程序写入，记下最后一次请求的值，组字一结束立刻补写。
// 最终值与不保护时完全一致，只有写入时机挪了。
//
// 覆盖：input / textarea / select 的 .value、.disabled，以及
// setAttribute / removeAttribute 的 value、disabled、placeholder。
// 用户在组字期间自己敲的内容不受影响。
// ---------------------------------------------------------------------------
const imeGuard = (() => {
  const SELECTOR = 'input, textarea, select';
  const PROPS = ['value', 'disabled'];
  const ATTRS = new Set(['value', 'disabled', 'placeholder']);
  /** 元素 -> 挂起状态 */
  const guards = new WeakMap();
  const stats = { installed: 0, composing: false, deferred: 0, replayed: 0 };

  /** 沿原型链找属性描述符（value 定义在 HTMLInputElement.prototype 等） */
  function descriptorOf(el, prop) {
    let proto = Object.getPrototypeOf(el);
    while (proto !== null) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc !== undefined) return desc;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function install(el) {
    if (guards.has(el)) return;

    const protoDesc = {};
    for (const prop of PROPS) {
      const d = descriptorOf(el, prop);
      if (d && typeof d.set === 'function') protoDesc[prop] = d;
    }

    const s = {
      composing: false,
      /** 键 -> { kind: 'prop'|'attr'|'remove', name, desc, value } */
      pending: new Map(),
      flush: 0,
    };
    guards.set(el, s);

    // 1) 属性赋值
    for (const prop of Object.keys(protoDesc)) {
      const d = protoDesc[prop];
      Object.defineProperty(el, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          return d.get ? d.get.call(el) : undefined;
        },
        set(value) {
          if (s.composing) {
            s.pending.set(prop, { kind: 'prop', name: prop, desc: d, value });
            stats.deferred += 1;
            return;
          }
          d.set.call(el, value);
        },
      });
    }

    // 2) setAttribute / removeAttribute
    const rawSet = el.setAttribute.bind(el);
    const rawRemove = el.removeAttribute.bind(el);
    el.setAttribute = function (name, value) {
      const key = String(name).toLowerCase();
      if (s.composing && ATTRS.has(key)) {
        s.pending.set('@' + key, { kind: 'attr', name: key, value });
        stats.deferred += 1;
        return;
      }
      return rawSet(name, value);
    };
    el.removeAttribute = function (name) {
      const key = String(name).toLowerCase();
      if (s.composing && ATTRS.has(key)) {
        s.pending.set('@' + key, { kind: 'remove', name: key });
        stats.deferred += 1;
        return;
      }
      return rawRemove(name);
    };

    // 3) 组字结束后补写最后请求的值
    const flushPending = () => {
      s.flush = 0;
      if (s.pending.size === 0) return;
      const items = [...s.pending.values()];
      s.pending.clear();
      for (const item of items) {
        if (item.kind === 'prop') item.desc.set.call(el, item.value);
        else if (item.kind === 'attr') rawSet(item.name, item.value);
        else rawRemove(item.name);
      }
      stats.replayed += 1;
    };

    const onStart = () => {
      if (s.flush !== 0) {
        clearTimeout(s.flush);
        s.flush = 0;
      }
      s.composing = true;
      stats.composing = true;
    };

    const onEnd = () => {
      s.composing = false;
      stats.composing = false;
      // 让浏览器先把这次组字落完，再补写程序请求过的值
      if (s.flush !== 0) clearTimeout(s.flush);
      s.flush = setTimeout(flushPending, 0);
    };

    el.addEventListener('compositionstart', onStart, true);
    el.addEventListener('compositionend', onEnd, true);
    stats.installed += 1;
  }

  function scan() {
    for (const el of document.querySelectorAll(SELECTOR)) install(el);
  }

  return { scan, stats };
})();

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------
function log(line, cls) {
  const el = $('log');
  // 第一行真日志进来时，把空态那句话撤掉
  const empty = el.querySelector('.log__empty');
  if (empty) empty.remove();
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
  // 进度走 transform：只动合成层，不改宽度触发布局
  $('bar').style.transform = `scaleX(${pct / 100})`;
  $('runPct').textContent = pct + '%';
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
async function init() {
  imeGuard.scan();
  window.__imeGuard = imeGuard.stats;

  if (!window.api || typeof window.api.info !== 'function') {
    log('[注意] 未接到主进程接口，界面只能看，不能跑下载', 'warn');
    return;
  }

  const info = await window.api.info();
  $('out').value = info.config.out || '';
  $('level').value = info.config.level || 'sky';
  $('concurrency').value = info.config.concurrency || 4;
  $('apiBadge').textContent = 'API 就绪 ' + info.apiBase.replace('http://', '');
  $('apiBadge').className = 'chip chip--on';
  setLoginBadge(info.hasCookie);
  log(`就绪 | 版本 ${info.version}`);
  log(`输出目录 ${info.config.out}`);
  log(`内置 API ${info.apiBase}`);
  if (!info.hasCookie) log('[注意] 未保存 cookie，VIP / 无损曲目会拿到试听片段', 'warn');
  const st = await window.api.state();
  if (st.running) setRunning(true);
}

function setLoginBadge(has) {
  const b = $('loginBadge');
  b.textContent = has ? '已登录' : '未登录';
  b.className = 'chip ' + (has ? 'chip--on' : 'chip--warn');
}

function setRunning(v) {
  state.running = v;
  $('btnStart').disabled = v;
  $('btnStop').disabled = !v;
  $('btnPreview').disabled = v;
}

// ---------------------------------------------------------------------------
// 来源
// ---------------------------------------------------------------------------
async function doPreview(target) {
  if (!target) return log('[注意] 请先填写歌单链接或选择清单文件', 'warn');
  log('解析中: ' + target);
  const r = await window.api.preview(target);
  if (!r.ok) {
    log('[FAIL] 解析失败: ' + r.message, 'fail');
    return;
  }
  const d = r.data;
  $('plName').textContent = d.name || '(无标题)';
  $('plMeta').textContent = `${d.creator || ''} · 共 ${d.count} 首`;
  const ol = $('plSongs');
  ol.innerHTML = '';
  (d.songs || []).slice(0, 300).forEach((s) => {
    const li = document.createElement('li');
    li.textContent = `${s.name} - ${(s.artists || []).join(', ')}`;
    ol.appendChild(li);
  });
  if ((d.songs || []).length > 300) {
    const li = document.createElement('li');
    li.textContent = `…… 其余 ${d.songs.length - 300} 首未列出`;
    ol.appendChild(li);
  }
  $('previewBox').classList.remove('hidden');
  log(`[解析成功] ${d.name} · ${d.count} 首`, 'ok');
}

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------
$('btnPreview').addEventListener('click', () => {
  state.fileTarget = '';
  $('fileName').textContent = '未选择';
  doPreview($('target').value.trim());
});
$('target').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnPreview').click();
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
  if (!target) return log('[注意] 请先填写歌单链接或选择清单文件', 'warn');
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
  log('开始下载: ' + target);
  const r = await window.api.start({
    target,
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

// preload 没接上时（例如页面被单独打开）不要整页崩掉，只在日志里说一声
if (window.api && typeof window.api.onLog === 'function') {
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
} else {
  log('[注意] 未接到主进程接口，界面只能看，不能跑下载', 'warn');
}

// ---------------------------------------------------------------------------
// 登录
// ---------------------------------------------------------------------------
$('btnLogin').addEventListener('click', () => {
  $('modal').classList.remove('hidden');
  $('cookieStatus').textContent = '';
  imeGuard.scan();
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
