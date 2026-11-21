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
  menu: () => inv('menu:toggle'), update: { state: () => inv('update:state'), check: () => inv('update:check'), install: () => inv('update:install') }, news: () => inv('news:list'),
  acc: { state: () => inv('acc:state'), signUp: d => inv('acc:signUp', d), signIn: d => inv('acc:signIn', d), google: () => inv('acc:google'), username: n => inv('acc:username', n), signOut: () => inv('acc:signOut'),
    friends: () => inv('acc:friends'), search: q => inv('acc:search', q), add: n => inv('acc:add', n), accept: id => inv('acc:accept', id), remove: id => inv('acc:remove', id) }, toast: (t, s, ms) => inv('toast', { t, s, ms }),
  on,
});
/* Overlay-Fenster (Strg+L-Menü und Hinweise) */
contextBridge.exposeInMainWorld('ovl', { on, act: (a, arg) => inv('menu:act', a, arg) });
