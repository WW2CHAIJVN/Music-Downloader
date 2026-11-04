'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  saveConfig: (patch) => ipcRenderer.invoke('cfg:save', patch),
  pickOut: () => ipcRenderer.invoke('cfg:pickOut'),
  pickFile: () => ipcRenderer.invoke('cfg:pickFile'),
  pickFfmpeg: () => ipcRenderer.invoke('cfg:pickFfmpeg'),
  preview: (target) => ipcRenderer.invoke('pl:preview', target),
  start: (job) => ipcRenderer.invoke('dl:start', job),
  stop: () => ipcRenderer.invoke('dl:stop'),
  state: () => ipcRenderer.invoke('dl:state'),
  openOut: (dir) => ipcRenderer.invoke('dl:openOut', dir),
  saveCookie: (c) => ipcRenderer.invoke('auth:saveCookie', c),
  checkLogin: () => ipcRenderer.invoke('auth:check'),
  qr: () => ipcRenderer.invoke('auth:qr'),
  qrCheck: (unikey) => ipcRenderer.invoke('auth:qrCheck', unikey),
  onLog: (fn) => on('dl:log', fn),
  onStats: (fn) => on('dl:stats', fn),
  onDone: (fn) => on('dl:done', fn),
});
