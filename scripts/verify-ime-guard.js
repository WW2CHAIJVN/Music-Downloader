'use strict';
/**
 * imeGuard 行为验证：在 Electron 窗口里跑真实 DOM，不依赖 GUI 其余部分。
 * 用法：npx electron scripts/verify-ime-guard.js
 * 退出码 0 = 全部通过。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const CASES = `(() => {
  const results = [];
  const ok = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra ?? null });

  const input = document.createElement('input');
  const num = document.createElement('input');
  num.type = 'number';
  const ta = document.createElement('textarea');
  document.body.append(input, num, ta);

  imeGuard.scan();
  ok('install-count', imeGuard.stats.installed >= 3, imeGuard.stats.installed);

  // 1) 组字期间写 value 必须挂起，结束后补写
  input.value = 'before';
  input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  input.value = 'deferred-value';
  ok('value-held-during-composition', input.value === 'before', input.value);
  input.dispatchEvent(new CompositionEvent('compositionend', { data: 'nihao' }));

  // 2) 组字期间写 disabled 也必须挂起
  num.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  num.disabled = true;
  ok('disabled-held-during-composition', num.disabled === false, num.disabled);
  num.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));

  // 3) 非组字期间写 value 立即生效
  ta.value = 'immediate';
  ok('value-immediate-when-idle', ta.value === 'immediate', ta.value);

  // 4) setAttribute 的 value 也走同一套
  num.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  num.setAttribute('value', 'attr-held');
  ok('attr-held-during-composition', num.getAttribute('value') !== 'attr-held', num.getAttribute('value'));
  num.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));

  return results;
})()`;

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false },
  });

  // 把 app.js 里 imeGuard 那段原样搬进来跑：直接加载真实文件太依赖 IPC，
  // 这里只抽 IIFE，保证测的是同一份源码。
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const start = src.indexOf('const imeGuard = (() => {');
  const endMarker = '\n})();';
  const end = src.indexOf(endMarker, start) + endMarker.length;
  if (start < 0 || end <= start) {
    console.error('找不到 imeGuard 实现');
    app.exit(2);
    return;
  }
  const guardSrc = src.slice(start, end);

  const html = `<!doctype html><html><body><script>
    window.imeGuard = undefined;
    ${guardSrc}
    window.__imeGuard = imeGuard;
  </script></body></html>`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const results = await win.webContents.executeJavaScript(
    CASES.replace('imeGuard', 'window.__imeGuard')
  );

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra !== null ? '  -> ' + JSON.stringify(r.extra) : ''));
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  app.exit(failed === 0 ? 0 : 1);
})();
