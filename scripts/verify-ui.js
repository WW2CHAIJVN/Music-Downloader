'use strict';
/**
 * 验收：真跑一遍主进程 + 渲染进程。
 * 有 --mock 时把 window.api 换成假实现，往界面灌一份样例数据，
 * 好让运行中、预览、登录弹窗这些状态都能被看到（截一份图）。
 *
 * 用法：
 *   npx electron scripts/verify-ui.js            # 真主进程，检查装上与渲染
 *   npx electron scripts/verify-ui.js --mock     # 假 API，走一遍状态并截图
 * 退出码 0 = 全部通过。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(os.tmpdir(), 'md-verify-' + process.pid));

const ROOT = path.join(__dirname, '..');
const MOCK = process.argv.includes('--mock');
const SHOT = path.join(os.tmpdir(), 'md-ui-' + process.pid + (MOCK ? '-mock' : '') + '.png');

require(path.join(ROOT, 'src', 'main', 'main.js'));

async function main() {
  console.log('main start');
  await app.whenReady();
  console.log('app ready');
  setTimeout(() => {
    console.error('verify-ui: 超时退出');
    app.exit(3);
  }, 60000).unref();
  const win = new BrowserWindow({
    width: 1440,
    height: 924,
    show: false,
    backgroundColor: '#161219',
    webPreferences: {
      preload: MOCK ? path.join(__dirname, 'mock-preload.js') : path.join(ROOT, 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (event) => {
    const level = event && event.level !== undefined ? event.level : undefined;
    const message = event && event.message !== undefined ? event.message : undefined;
    if (level === 'error' || level === 3) errors.push(String(message));
  });

  // 用 loadURL 而不是 loadFile：main.js 自己也建了窗口，
  // 两个窗口抢同一个 inspector 目标时 loadFile 的 promise 会挂住。
  const fileUrl = pathToFileURL(path.join(ROOT, 'src', 'renderer', 'index.html')).href;
  await Promise.race([
    win.loadURL(fileUrl),
    new Promise((_, rej) => setTimeout(() => rej(new Error('loadURL 超时')), 20000)),
  ]);
  await new Promise((r) => setTimeout(r, 2200));
  const results = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    const ok = (n, p, e) => out.push({ p: !!p, n, e: e ?? null });

    ok('imeGuard-installed', window.__imeGuard && window.__imeGuard.installed >= 6, window.__imeGuard);

    const ids = ['apiBadge','bar','btnCheckLogin','btnLogin','btnModalClose','btnOpenOut','btnPickFile','btnPickOut',
      'btnPreview','btnQr','btnSaveCookie','btnStart','btnStop','chain','concurrency','cookieInput','cookieStatus',
      'fileName','level','limit','log','loginBadge','modal','out','plMeta','plName','plSongs','previewBox','qrBox',
      'qrImg','qrStatus','stFail','stOk','stSkip','stTotal','stTrial','target'];
    const missing = ids.filter((id) => !document.getElementById(id));
    ok('all-37-ids', missing.length === 0, missing);

    const bar = document.querySelector('.bar');
    const br = bar.getBoundingClientRect();
    ok('header-visible', br.width > 200 && br.height > 20, { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), offsetW: bar.offsetWidth, disp: getComputedStyle(bar).display });
    const login = document.getElementById('btnLogin').getBoundingClientRect();
    ok('login-button-visible', login.width > 40 && login.height > 20, { w: Math.round(login.width), h: Math.round(login.height) });

    const api = document.getElementById('apiBadge');
    ok('api-badge-on', api.className.includes('chip--on'), api.textContent);
    ok('fonts-loaded', document.fonts.check('16px Outfit') && document.fonts.check('16px Onest'),
      [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));

    // 组字中途写值必须挂起，结束后补写
    const text = document.getElementById('target');
    text.value = 'a';
    text.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    text.value = 'b';
    const held = text.value === 'a';
    text.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
    ok('live-value-held', held, text.value);

    if (window.__mdmock) {
      // 灌一份运行中的样例：预览 + 统计 + 日志
      document.getElementById('btnPreview').click();
      await new Promise((r) => setTimeout(r, 80));
      window.__mdmock.stats({ ok: 12, skip: 3, fail: 1, trial: 2, total: 24 });
      ['就绪 | 版本 1.1.0', '开始下载: 华语热歌榜',
       '   [OK] 示例曲目一 - 歌手甲', '   [OK] 示例曲目二 - 歌手乙',
       '   [FAIL] 示例曲目三 - 试听片段，跳过', '[降级] sky -> lossless'].forEach((l) => window.__mdmock.log(l));
      await new Promise((r) => setTimeout(r, 80));
      ok('stats-rendered', document.getElementById('stOk').textContent === '12', document.getElementById('stOk').textContent);
      ok('pct-rendered', document.getElementById('runPct').textContent === '75%', document.getElementById('runPct').textContent);
      ok('bar-scaled', /scaleX\\(0\\.75\\)/.test(document.getElementById('bar').style.transform),
        document.getElementById('bar').style.transform);
      ok('preview-open', !document.getElementById('previewBox').classList.contains('hidden'));
    }
    return out;
  })()`);

  await new Promise((r) => setTimeout(r, 150));
  const replayed = await win.webContents.executeJavaScript(
    "document.getElementById('target').value === 'b' || !!window.__mdmock"
  );
  results.push({ n: 'live-value-replayed', p: replayed, e: null });

  const img = await win.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  console.log('screenshot: ' + SHOT);

  // 窄屏复查：状态芯片、账本列数与孤格、开始下载是否在首屏
  // 隐藏窗口的 setSize 不一定重排，直接改 webContents 的视口尺寸
  try {
    win.webContents.debugger.attach('1.3');
    win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch (e) {
    console.error('emulation failed: ' + e.message);
  }
  await new Promise((r) => setTimeout(r, 900));
  const narrow = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    const ok = (n, p, e) => out.push({ p: !!p, n, e: e ?? null });
    const chip = document.getElementById('loginBadge');
    ok('phone-login-chip-visible', chip.getBoundingClientRect().height > 0, chip.getBoundingClientRect().height);
    const api = document.getElementById('apiBadge');
    ok('phone-api-chip-given-up', api.getBoundingClientRect().height === 0, api.getBoundingClientRect().height);
    const cells = [...document.querySelectorAll('.stat')];
    // 每个计数格独占一行（单列清单）时不会出现孤格
    const rows = new Map();
    cells.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top); rows.set(t, (rows.get(t) || 0) + 1); });
    const counts = [...rows.values()];
    ok('phone-ledger-one-per-row', counts.length === 5 && counts.every((n) => n === 1), counts);
    ok('phone-doc-no-hscroll', document.documentElement.scrollWidth <= 376, document.documentElement.scrollWidth);
    const log = document.getElementById('log');
    ok('log-empty-state', !!log.querySelector('.log__empty') || log.childElementCount > 0, log.textContent.slice(0, 20));
    return out;
  })()`);
  for (const r of narrow) results.push(r);
  const narrowShot = path.join(os.tmpdir(), 'md-ui-375-' + process.pid + '.png');
  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(narrowShot, img2.toPNG());
  console.log('narrow screenshot: ' + narrowShot);

  let failed = 0;
  for (const r of results) {
    if (!r.p) failed += 1;
    console.log((r.p ? 'PASS  ' : 'FAIL  ') + r.n + (r.e !== null ? '  -> ' + JSON.stringify(r.e) : ''));
  }
  for (const e of errors) console.log('CONSOLE-ERROR  ' + e);
  failed += errors.length;
  console.log(`\n${results.length} checks, ${failed} failed, ${errors.length} console errors`);

  if (!process.env.MD_SHOT_KEEP) {
    try { fs.unlinkSync(SHOT); } catch {}
    try { fs.unlinkSync(narrowShot); } catch {}
  }
  // 硬超时：主进程里可能有自己的窗口或退出拦截，别让验收挂死
  setTimeout(() => app.exit(failed === 0 ? 0 : 1), 200);
}

main().catch((e) => {
  console.error(e);
  app.exit(2);
});
