#!/usr/bin/env node
/**
 * 网易云音乐二维码登录，成功后把 cookie 写入 cookie.txt
 * 用法: node login.js [cookie输出路径]
 */
const fs = require('fs');
const path = require('path');

const API = process.env.NCM_API || 'http://127.0.0.1:3001';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const outFile = process.argv[2] || path.resolve(__dirname, 'cookie.txt');
const qrFile = path.resolve(__dirname, 'qrcode.png');

async function api(p, params = {}) {
  const qs = new URLSearchParams({ ...params, timestamp: Date.now() });
  const res = await fetch(`${API}${p}?${qs}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${p} HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const keyR = await api('/login/qr/key');
  const key = keyR.data?.unikey;
  if (!key) throw new Error('获取二维码 key 失败: ' + JSON.stringify(keyR).slice(0, 200));

  const createR = await api('/login/qr/create', { key, qrimg: 'true' });
  const data = createR.data || {};
  if (data.qrimg) {
    const b64 = data.qrimg.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(qrFile, Buffer.from(b64, 'base64'));
    console.log('二维码已保存: ' + qrFile);
  }
  console.log('二维码链接(手机可扫): ' + (data.qrurl || '无'));

  const deadline = Date.now() + 180000;
  let lastCode = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const chk = await api('/login/qr/check', { key });
    const code = chk.code;
    if (code !== lastCode) {
      const label = { 800: '二维码已过期', 801: '等待扫码', 802: '已扫码，等待确认', 803: '登录成功' }[code] || String(code);
      console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] ' + label);
      lastCode = code;
    }
    if (code === 800) throw new Error('二维码过期，请重跑');
    if (code === 803) {
      const cookie = chk.cookie || '';
      if (!cookie) throw new Error('登录成功但未返回 cookie');
      fs.writeFileSync(outFile, cookie);
      console.log('cookie 已写入: ' + outFile);
      const st = await api('/login/status', { cookie });
      const p = st.data?.profile;
      console.log('账号: ' + (p ? `${p.nickname} (uid ${p.userId})` : '未知'));
      const vip = st.data?.account?.vipType;
      console.log('会员类型: ' + (vip ? 'VIP' : '非会员'));
      return;
    }
  }
  throw new Error('等待扫码超时');
})().catch((e) => {
  console.error('登录失败: ' + e.message);
  process.exit(1);
});
