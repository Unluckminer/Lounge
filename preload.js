const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  config: () => inv('cfg:get'), setConfig: d => inv('cfg:set', d),
  saveApp: d => inv('apps:save', d), removeApp: id => inv('apps:remove', id), moveApp: (id, dir) => inv('apps:move', id, dir), launch: id => inv('apps:launch', id),
  pickExe: () => inv('dlg:exe'), pickImage: () => inv('dlg:img'), wallPick: () => inv('wall:pick'), wallClear: () => inv('wall:clear'),
  power: k => inv('power', k), remoteInfo: () => inv('remote:info'), unpair: () => inv('remote:unpair'), quit: () => inv('app:quit'),
  on: (ch, fn) => ipcRenderer.on(ch, (_, d) => fn(d)),
});
