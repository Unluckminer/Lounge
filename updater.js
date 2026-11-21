/* Automatische Updates über GitHub Releases.
   - Windows (Installer) und Linux (AppImage): lädt im Hintergrund, installiert beim Beenden oder per Knopf "Neu starten" (electron-updater).
   - Windows portable und macOS (ohne Apple-Signatur geht kein stilles Update): Hinweis + Knopf, der die Download-Seite öffnet.
   Das GitHub-Repository wird aus package.json ("repository") gelesen; der Build-Workflow trägt es automatisch ein. */
module.exports = function createUpdater({ app, shell, send, toast, T, log }) {
  let info = { state: 'idle', version: app.getVersion() }, au = null, timer = 0, busy = false;
  const repo = (() => {
    try { const r = require('./package.json').repository, s = typeof r === 'string' ? r : (r && r.url) || ''; const m = s.match(/github(?:\.com)?[:/]([^/]+\/[^/.#]+)/i); return m && m[1] !== 'OWNER' ? m[1] : null; } catch { return null; }
  })();
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  const canAuto = app.isPackaged && !portable && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE));
  const set = p => { info = Object.assign({}, info, p); send('update', info); };
  const newer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(n => parseInt(n) || 0), y = String(b).replace(/^v/, '').split('.').map(n => parseInt(n) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

  if (canAuto) {
    try {
      au = require('electron-updater').autoUpdater;
      au.autoDownload = true; au.autoInstallOnAppQuit = true; au.logger = null;
      au.on('checking-for-update', () => set({ state: 'checking' }));
      au.on('update-available', i => set({ state: 'downloading', next: i.version, percent: 0 }));
      au.on('download-progress', p => set({ state: 'downloading', percent: Math.round(p.percent) }));
      au.on('update-not-available', () => set({ state: 'latest' }));
      au.on('update-downloaded', i => { set({ state: 'ready', next: i.version }); toast({ t: T('updReady'), s: 'v' + i.version, ms: 7000 }); });
      au.on('error', e => { log(e); set({ state: 'error' }); });
    } catch (e) { log(e); au = null; }
  }
  async function manualCheck() {
    if (!repo) return set({ state: 'idle' });
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': 'Lounge-Updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return set({ state: 'latest' });
    const j = await r.json();
    if (j && j.tag_name && newer(j.tag_name, app.getVersion())) { set({ state: 'manual', next: String(j.tag_name).replace(/^v/, ''), url: j.html_url }); toast({ t: T('updNew'), s: 'v' + String(j.tag_name).replace(/^v/, ''), ms: 7000 }); }
    else set({ state: 'latest' });
  }
  async function check() {
    if (busy || !app.isPackaged || ['downloading', 'ready'].includes(info.state)) return info;
    busy = true;
    try { if (au) await au.checkForUpdates(); else await manualCheck(); } catch (e) { log(e); set({ state: 'error' }); }
    busy = false; return info;
  }
  function install() {
    if (info.state === 'ready' && au) { try { au.quitAndInstall(true, true); } catch (e) { log(e); } }
    else if (info.url) shell.openExternal(info.url);
  }
  function start() {
    if (!app.isPackaged) return;
    setTimeout(check, 15000); timer = setInterval(check, 4 * 3600 * 1000);
  }
  return { start, check, install, state: () => info };
};
