const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
const on = (ch, fn) => ipcRenderer.on(ch, (_, d) => fn(d));
/* Launcher */
contextBridge.exposeInMainWorld('api', {
  config: () => inv('cfg:get'), setConfig: d => inv('cfg:set', d),
  saveApp: d => inv('apps:save', d), removeApp: (id, quick) => inv('apps:remove', id, !!quick), moveApp: (id, dir, quick) => inv('apps:move', id, dir, !!quick),
  launch: id => inv('apps:launch', id), closeApp: id => inv('apps:close', id), quickLaunch: id => inv('quick:launch', id),
  programs: () => inv('programs:list'), sys: () => inv('sys:info'),
  pickExe: () => inv('dlg:exe'), pickImage: () => inv('dlg:img'), wallPick: () => inv('wall:pick'), wallClear: () => inv('wall:clear'),
  power: k => inv('power', k), remoteInfo: () => inv('remote:info'), unpair: () => inv('remote:unpair'), quit: () => inv('app:quit'),
  menu: () => inv('menu:toggle'), toast: (t, s, ms) => inv('toast', { t, s, ms }),
  on,
});
/* Overlay-Fenster (Strg+L-Menü und Hinweise) */
contextBridge.exposeInMainWorld('ovl', { on, act: (a, arg) => inv('menu:act', a, arg) });
