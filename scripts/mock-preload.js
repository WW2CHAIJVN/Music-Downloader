'use strict';
/**
 * 验收用的假 API preload：把 window.api 换成本地实现，
 * 让界面在没有网易云网络的情况下也能走一遍运行中、预览、登录等状态。
 * 只在 scripts/verify-ui.js --mock 时加载。
 */
const { contextBridge } = require('electron');

const handlers = { log: null, stats: null, done: null };

const api = {
  onLog(fn) {
    handlers.log = fn;
  },
  onStats(fn) {
    handlers.stats = fn;
  },
  onDone(fn) {
    handlers.done = fn;
  },
  info: async () => ({
    apiBase: 'http://127.0.0.1:3141',
    hasCookie: false,
    version: '1.1.0',
    config: { out: 'D:\\music\\NCM', level: 'sky', concurrency: 4 },
  }),
  state: async () => ({ running: false, run: null }),
  preview: async () => ({
    ok: true,
    data: {
      name: '华语热歌榜',
      creator: '网易云音乐',
      count: 3,
      songs: [
        { name: '示例曲目一', artists: ['歌手甲'] },
        { name: '示例曲目二', artists: ['歌手乙'] },
        { name: '示例曲目三', artists: ['歌手丙'] },
      ],
    },
  }),
  start: async () => ({ ok: true, pid: 1 }),
  stop: async () => ({ ok: true }),
  pickFile: async () => 'V:\\inbox\\songs.txt',
  pickOut: async () => 'D:\\music\\NCM',
  saveConfig: async () => ({}),
  saveCookie: async () => ({ ok: true, hasCookie: true }),
  checkLogin: async () => ({ ok: true, data: { profile: { nickname: '示例用户', userId: 1 } } }),
  qr: async () => ({ unikey: 'k', qrimg: '' }),
  qrCheck: async () => ({ code: 801 }),
  openOut: () => {},
};

contextBridge.exposeInMainWorld('api', api);

// 给验收脚本一个往界面灌状态的口子
contextBridge.exposeInMainWorld('__mdmock', {
  stats(s) {
    handlers.stats?.(s);
  },
  log(l) {
    handlers.log?.(l);
  },
  done(d) {
    handlers.done?.(d);
  },
});
