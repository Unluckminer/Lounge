const { app, BrowserWindow, ipcMain, dialog, nativeImage, screen } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const I18N = require('./renderer/i18n.js');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const P = process.platform, WIN = P === 'win32', MAC = P === 'darwin';
/* AppImage unter neueren Linux-Systemen (z. B. Ubuntu 24.04) startet sonst wegen der Sandbox-Regeln nicht */
if (P === 'linux') app.commandLine.appendSwitch('no-sandbox');

/* Fehler werden in eine Datei geschrieben, damit ein "nichts passiert" immer nachvollziehbar ist */
function logErr(e) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `[${new Date().toISOString()}] ${(e && e.stack) || e}\n`); } catch {}
}
process.on('uncaughtException', logErr);
process.on('unhandledRejection', logErr);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SCRIPTS = app.isPackaged ? path.join(process.resourcesPath, 'scripts') : path.join(__dirname, 'scripts');
const KEYS = new Set(['Up','Down','Left','Right','Enter','Esc','Tab','Space','Backspace','Delete','Home','End','Apps','Win','F','F11','VolUp','VolDown','Mute','PlayPause','Next','Prev']);
const newPin = () => String(crypto.randomInt(1000, 10000));
const SETTINGS = ['city','lat','lon','escClose','deviceName','accent','theme','lang','onboarded','h24','fahr','sounds','calm','slide','wallDefaults','fontScale','widgets'];

let cfg = { apps: [], city: '', lat: null, lon: null, escClose: true, tokens: [], deviceName: '', accent: '#0a84ff',
  theme: 'system', lang: '', onboarded: false, h24: true, fahr: false, sounds: false, calm: true, wall: null,
  walls: [], slide: true, wallDefaults: true, fontScale: 1, widgets: null };
let launcher = null, siteWin = null, exeProc = null, killer = null, current = null, wss = null, lastEsc = 0;
let remoteUrl = '', PIN = newPin(), psIn = null, psEsc = null, hint = null, hintT = null, CFG_FILE, ICONS, DATA, WALLS;

/* ---------- Config ---------- */
function load() {
  DATA = app.getPath('userData'); CFG_FILE = path.join(DATA, 'config.json'); ICONS = path.join(DATA, 'icons');
  WALLS = path.join(DATA, 'wallpapers');
  fs.mkdirSync(ICONS, { recursive: true }); fs.mkdirSync(WALLS, { recursive: true });
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch {}
  /* altes einzelnes Hintergrundbild in die neue Liste übernehmen */
  if (!Array.isArray(cfg.walls)) cfg.walls = [];
  if (cfg.wall) { if (fs.existsSync(cfg.wall) && !cfg.walls.includes(cfg.wall)) cfg.walls.push(cfg.wall); cfg.wall = null; }
  if (!cfg.lang) cfg.lang = I18N.pick(app.getLocale());
  if (!cfg.deviceName) cfg.deviceName = os.hostname();
}
const save = () => fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
const pub = a => ({ id: a.id, type: a.type, name: a.name, target: a.target, engine: a.engine || 'auto', color: a.color || null,
  icon: a.icon && fs.existsSync(a.icon) ? pathToFileURL(a.icon).href : null });
const send = (ch, d) => launcher && !launcher.isDestroyed() && launcher.webContents.send(ch, d);
const pushApps = () => { send('apps', cfg.apps.map(pub)); broadcast(); };
const wallUrls = () => cfg.walls.filter(f => fs.existsSync(f)).map(f => pathToFileURL(f).href + '?t=' + fs.statSync(f).mtimeMs);
/* Mitgelieferte Standard-Bilder: einfach Bilder in renderer/wallpapers/ legen, sie werden automatisch erkannt */
const defWalls = () => {
  try { return fs.readdirSync(path.join(__dirname, 'renderer', 'wallpapers')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort().map(f => 'wallpapers/' + f); } catch { return []; }
};

/* ---------- Eingabe-Treiber (Windows: PowerShell, macOS: osascript/cliclick, Linux: xdotool) ---------- */
function startPS() {
  if (!WIN) return;
  const args = f => ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, f)];
  psIn = spawn('powershell.exe', args('input.ps1'), { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  psIn.stdin.on('error', () => {}); psIn.on('error', () => { psIn = null; }); psIn.on('exit', () => { psIn = null; });
  psEsc = spawn('powershell.exe', args('esc.ps1'), { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  psEsc.on('error', () => {});
  psEsc.stdout.on('data', d => { if (String(d).includes('ESC2') && current && cfg.escClose) closeCurrent(); });
}
const ps = l => { if (psIn && psIn.stdin.writable) psIn.stdin.write(String(l).replace(/[\r\n]/g, ' ') + '\n'); };
const run = (c, a) => { try { spawn(c, a, { stdio: 'ignore' }).on('error', () => {}); } catch {} };
const osa = s => run('osascript', ['-e', s]);
const MK = { Up: 126, Down: 125, Left: 123, Right: 124, Enter: 36, Esc: 53, Tab: 48, Space: 49, Backspace: 51, Delete: 117, Home: 115, End: 119, F: 3, F11: 103, Prev: 98, PlayPause: 100, Next: 101 };
const XK = { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Enter: 'Return', Esc: 'Escape', Tab: 'Tab', Space: 'space', Backspace: 'BackSpace', Delete: 'Delete', Home: 'Home', End: 'End', Apps: 'Menu', Win: 'Super_L', F: 'f', F11: 'F11', VolUp: 'XF86AudioRaiseVolume', VolDown: 'XF86AudioLowerVolume', Mute: 'XF86AudioMute', PlayPause: 'XF86AudioPlay', Next: 'XF86AudioNext', Prev: 'XF86AudioPrev' };
const sg = n => (n >= 0 ? '+' : '') + n;
const input = {
  key(k) {
    if (WIN) return ps('key ' + k);
    if (MAC) {
      if (k === 'VolUp') return osa('set volume output volume ((output volume of (get volume settings)) + 6)');
      if (k === 'VolDown') return osa('set volume output volume ((output volume of (get volume settings)) - 6)');
      if (k === 'Mute') return osa('set volume output muted (not (output muted of (get volume settings)))');
      if (MK[k] != null) osa(`tell application "System Events" to key code ${MK[k]}`); return;
    }
    run('xdotool', ['key', XK[k] || k]);
  },
  combo(c) {
    if (WIN) return ps(c);
    if (MAC) return osa('tell application "System Events" to ' + { alttab: 'key code 48 using command down', altf4: 'keystroke "w" using command down', altleft: 'key code 123 using command down' }[c]);
    run('xdotool', ['key', { alttab: 'alt+Tab', altf4: 'alt+F4', altleft: 'alt+Left' }[c]]);
  },
  text(t) {
    if (WIN) return ps('text ' + Buffer.from(t).toString('base64'));
    if (MAC) return run('osascript', ['-e', 'on run argv', '-e', 'tell application "System Events" to keystroke (item 1 of argv)', '-e', 'end run', t]);
    run('xdotool', ['type', '--delay', '0', '--', t]);
  },
  move(dx, dy) { if (WIN) ps(`move ${dx} ${dy}`); else if (MAC) run('cliclick', [`m:${sg(dx)},${sg(dy)}`]); else run('xdotool', ['mousemove_relative', '--', String(dx), String(dy)]); },
  click(b) { if (WIN) ps('click ' + b); else if (MAC) run('cliclick', [b === 'r' ? 'rc:.' : 'c:.']); else run('xdotool', ['click', b === 'r' ? '3' : '1']); },
  scroll(d) { if (WIN) ps('scroll ' + d); else if (MAC) osa('tell application "System Events" to key code ' + (d > 0 ? 126 : 125)); else run('xdotool', ['click', d > 0 ? '4' : '5']); },
};
function power(kind) {
  const c = { win32: { sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']], restart: ['shutdown', ['/r', '/t', '0']], shutdown: ['shutdown', ['/s', '/t', '0']] },
    darwin: { sleep: ['pmset', ['sleepnow']], restart: ['osascript', ['-e', 'tell app "System Events" to restart']], shutdown: ['osascript', ['-e', 'tell app "System Events" to shut down']] },
    linux: { sleep: ['systemctl', ['suspend']], restart: ['systemctl', ['reboot']], shutdown: ['systemctl', ['poweroff']] } }[P];
  if (c && c[kind]) run(c[kind][0], c[kind][1]);
}

/* ---------- Fenster ---------- */
function createLauncher() {
  launcher = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#000', autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  launcher.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  launcher.on('closed', () => app.quit());
}
function showLauncher() { if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.setFullScreen(true); launcher.focus(); } }
const goBack = wc => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack());

const DRM_RE = /netflix\.|disneyplus\.|primevideo\.|amazon\.|max\.com|hbomax\.|paramountplus\.|spotify\.|wowtv\.|dazn\.|crunchyroll\.|tv\.apple\.|hulu\.|peacocktv\.|magentatv\.|joyn\.|zattoo\.|waipu\./i;
function findBrowser() {
  let c = [];
  if (WIN) {
    const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    for (const [rel, edge] of [['Microsoft\\Edge\\Application\\msedge.exe', 1], ['Google\\Chrome\\Application\\chrome.exe', 0]]) for (const b of bases) c.push([path.join(b, rel), edge]);
  } else if (MAC) c = [['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 1], ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 0]];
  else c = [['/usr/bin/microsoft-edge', 1], ['/usr/bin/google-chrome', 0], ['/usr/bin/google-chrome-stable', 0], ['/usr/bin/chromium', 0], ['/usr/bin/chromium-browser', 0]];
  const f = c.find(x => fs.existsSync(x[0])); return f ? { exe: f[0], edge: !!f[1] } : null;
}
function pickBrowser(a) {
  const e = a.engine || 'auto';
  if (e === 'builtin') return null;
  if (e === 'auto') { try { if (!DRM_RE.test(new URL(a.target).hostname)) return null; } catch { return null; } }
  return findBrowser();
}
function killTree(p) {
  if (!p || !p.pid) return;
  if (WIN) spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill(); } catch {} } }
}
function track(p, kill) {
  const back = () => { if (exeProc === p) { exeProc = null; killer = null; current = null; hideHint(); showLauncher(); broadcast(); } };
  exeProc = p; killer = kill || (() => killTree(p)); p.on('exit', back); p.on('error', back);
}
function openApp(id) {
  const a = cfg.apps.find(x => x.id === id); if (!a) return;
  if (current) closeCurrent();
  current = { id: a.id, name: a.name, type: a.type };
  if (a.type === 'web') { const b = pickBrowser(a); b ? openBrowser(a, b) : openSite(a); } else openExe(a);
  launcher.hide(); showHint(); broadcast();
}
function openBrowser(a, b) {
  current.edge = true;
  const args = ['--kiosk', a.target, '--user-data-dir=' + path.join(DATA, b.edge ? 'edge-profile' : 'chrome-profile'),
    '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble', '--autoplay-policy=no-user-gesture-required'];
  if (b.edge) args.push('--edge-kiosk-type=fullscreen');
  track(spawn(b.exe, args, { stdio: 'ignore', detached: !WIN }));
}
function openSite(a) {
  const w = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#000', autoHideMenuBar: true,
    webPreferences: { partition: 'persist:sites', sandbox: true } });
  siteWin = w; const wc = w.webContents;
  wc.setUserAgent(UA);
  wc.setWindowOpenHandler(({ url }) => { wc.loadURL(url); return { action: 'deny' }; });
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.alt && i.key === 'ArrowLeft') { goBack(wc); e.preventDefault(); }
    if (i.key === 'Escape' && cfg.escClose) { const n = Date.now(); if (n - lastEsc < 700) { lastEsc = 0; closeCurrent(); } else lastEsc = n; }
  });
  w.on('closed', () => { if (siteWin === w) { siteWin = null; current = null; hideHint(); showLauncher(); broadcast(); } });
  w.loadURL(a.target); w.focus();
}
function openExe(a) {
  if (MAC && /\.app\/?$/i.test(a.target)) {
    const n = path.basename(a.target.replace(/\/$/, ''), '.app');
    return track(spawn('open', ['-W', '-a', a.target], { stdio: 'ignore' }), () => osa(`tell application "${n.replace(/"/g, '')}" to quit`));
  }
  const p = spawn(a.target, [], { cwd: path.dirname(a.target), stdio: 'ignore', detached: !WIN });
  track(p);
}
function closeCurrent() {
  const k = killer, w = siteWin;
  current = null; exeProc = null; killer = null; siteWin = null;
  if (w && !w.isDestroyed()) w.destroy();
  if (k) k();
  hideHint(); showLauncher(); broadcast();
}

/* ---------- Hinweis-Overlay ---------- */
function hideHint() { clearTimeout(hintT); if (hint && !hint.isDestroyed()) hint.destroy(); hint = null; }
function showHint() {
  hideHint(); if (!current) return;
  const b = screen.getPrimaryDisplay().bounds, w = 600, h = 100;
  const canEsc = cfg.escClose && (WIN || !!siteWin);
  hint = new BrowserWindow({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + 48, width: w, height: h, transparent: true, frame: false,
    resizable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false });
  hint.setIgnoreMouseEvents(true); hint.setAlwaysOnTop(true, 'screen-saver');
  hint.loadFile(path.join(__dirname, 'renderer', 'hint.html'), { query: { n: current.name, e: canEsc ? '1' : '0', l: cfg.lang } });
  hint.once('ready-to-show', () => hint && !hint.isDestroyed() && hint.showInactive());
  hintT = setTimeout(hideHint, 7500);
}

/* ---------- Icons ---------- */
const sniff = b => {
  const h = b.subarray(0, 4).toString('hex');
  if (h === '89504e47') return 'png'; if (h.startsWith('ffd8')) return 'jpg'; if (h === '52494646') return 'webp';
  if (h === '00000100') return 'ico'; if (b.subarray(0, 300).toString().includes('<svg')) return 'svg'; return 'png';
};
function avgColor(buf) {
  try {
    const bm = nativeImage.createFromBuffer(buf).resize({ width: 16, height: 16 }).toBitmap();
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < bm.length; i += 4) {
      const a = bm[i + 3] / 255; if (a < 0.5) continue;
      const B = bm[i], G = bm[i + 1], R = bm[i + 2], wt = a * (0.15 + (Math.max(R, G, B) - Math.min(R, G, B)) / 255);
      r += R * wt; g += G * wt; b += B * wt; w += wt;
    }
    if (w) return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
  } catch {}
  return null;
}
async function webIcon(url) {
  const o = new URL(url);
  const get = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA } }); if (!r.ok) throw 0; return r; };
  try {
    const html = await (await get(o.origin)).text();
    const m = html.match(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]*>/i), h = m && m[0].match(/href=["']([^"']+)["']/i);
    if (h) { const b = Buffer.from(await (await get(new URL(h[1], o.origin).href)).arrayBuffer()); if (b.length > 500) return b; }
  } catch {}
  return Buffer.from(await (await get(`https://www.google.com/s2/favicons?domain=${o.hostname}&sz=256`)).arrayBuffer());
}
async function makeIcon(a, d) {
  let buf = null;
  try {
    if (d.iconMode === 'file' && d.iconPath) buf = fs.readFileSync(d.iconPath);
    else if (a.type === 'exe') buf = (await app.getFileIcon(a.target, { size: 'large' })).toPNG();
    else buf = await webIcon(a.target);
  } catch {}
  if (!buf || !buf.length) { if (d.iconMode !== 'keep') { a.icon = null; a.color = null; } return; }
  const file = path.join(ICONS, `${a.id}-${Date.now()}.${sniff(buf)}`);
  fs.writeFileSync(file, buf);
  if (a.icon) try { fs.unlinkSync(a.icon); } catch {}
  a.icon = file; a.color = avgColor(buf);
}

/* ---------- Fernbedienungs-Server ---------- */
const mime = f => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[path.extname(f).toLowerCase()] || 'application/octet-stream');
function lanIp() {
  const c = [];
  for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) c.push(i.address);
  return c.find(a => /^192\.168\./.test(a)) || c.find(a => /^10\./.test(a)) || c.find(a => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) || c[0] || 'localhost';
}
const stateMsg = () => JSON.stringify({ t: 'state', mode: current ? current.type : 'launcher', name: current ? current.name : null,
  lang: cfg.lang, device: cfg.deviceName, accent: cfg.accent, theme: cfg.theme,
  apps: cfg.apps.map(a => ({ id: a.id, name: a.name, icon: a.icon ? '/icon/' + a.id + '?v=' + encodeURIComponent(path.basename(a.icon)) : null })) });
function broadcast() { if (!wss) return; const s = stateMsg(); wss.clients.forEach(c => c.authed && c.readyState === 1 && c.send(s)); }
function startServer(port = 4747) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const file = { '/': ['remote', 'index.html', 'text/html; charset=utf-8'], '/index.html': ['remote', 'index.html', 'text/html; charset=utf-8'], '/i18n.js': ['renderer', 'i18n.js', 'text/javascript; charset=utf-8'] }[u.pathname];
    if (file) { res.writeHead(200, { 'Content-Type': file[2], 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, file[0], file[1]))); }
    if (u.pathname.startsWith('/icon/')) {
      const a = cfg.apps.find(x => x.id === u.pathname.slice(6));
      if (a && a.icon && fs.existsSync(a.icon)) { res.writeHead(200, { 'Content-Type': mime(a.icon), 'Cache-Control': 'max-age=3600' }); return fs.createReadStream(a.icon).pipe(res); }
    }
    res.writeHead(404); res.end();
  });
  srv.on('error', e => { if (e.code === 'EADDRINUSE' && port < 4800) startServer(port + 1); });
  srv.listen(port, '0.0.0.0');
  srv.on('listening', () => {
    remoteUrl = `http://${lanIp()}:${port}/`;
    wss = new WebSocketServer({ server: srv }); wss.on('error', () => {});
    wss.on('connection', (ws, req) => {
      ws.ip = req.socket.remoteAddress; ws.authed = false; ws.on('error', () => {});
      ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } ws.authed ? handle(m) : auth(ws, m); });
    });
  });
}
const fails = new Map();
function auth(ws, m) {
  if (m.t !== 'auth') return;
  const f = fails.get(ws.ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) return ws.send(JSON.stringify({ t: 'auth', ok: false, locked: Math.ceil((f.until - Date.now()) / 1000) }));
  let token = null;
  if (m.token && cfg.tokens.includes(m.token)) token = m.token;
  else if (m.pin && String(m.pin) === PIN) { token = crypto.randomBytes(24).toString('hex'); cfg.tokens.push(token); save(); PIN = newPin(); send('remote', { paired: cfg.tokens.length }); }
  if (token) { fails.delete(ws.ip); ws.authed = true; ws.send(JSON.stringify({ t: 'auth', ok: true, token })); ws.send(stateMsg()); }
  else { if (++f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ws.ip, f); ws.send(JSON.stringify({ t: 'auth', ok: false })); }
}
function handle(m) {
  switch (m.t) {
    case 'key': if (KEYS.has(m.k)) input.key(m.k); break;
    case 'combo': if (m.k === 'alttab' || m.k === 'altf4') input.combo(m.k); break;
    case 'text': input.text(String(m.v).slice(0, 300)); break;
    case 'move': input.move(m.dx | 0, m.dy | 0); break;
    case 'click': input.click(m.b === 'r' ? 'r' : 'l'); break;
    case 'scroll': input.scroll(m.d | 0); break;
    case 'back': if (siteWin && !siteWin.isDestroyed()) goBack(siteWin.webContents); else if (current && current.edge) input.combo('altleft'); else input.key('Esc'); break;
    case 'home': case 'close': closeCurrent(); break;
    case 'launch': openApp(String(m.id)); break;
    case 'hint': showHint(); break;
    case 'power': if (['sleep', 'restart', 'shutdown'].includes(m.k)) power(m.k); break;
  }
}

/* ---------- IPC ---------- */
/* Die portable .exe entpackt sich in einen Temp-Ordner: für den Autostart muss die echte .exe-Datei verwendet werden */
const LOGIN = () => (process.env.PORTABLE_EXECUTABLE_FILE ? { path: process.env.PORTABLE_EXECUTABLE_FILE } : {});
ipcMain.handle('cfg:get', () => ({ apps: cfg.apps.map(pub), city: cfg.city, lat: cfg.lat, lon: cfg.lon, escClose: cfg.escClose,
  deviceName: cfg.deviceName, accent: cfg.accent, theme: cfg.theme, lang: cfg.lang, onboarded: cfg.onboarded, h24: cfg.h24,
  fahr: cfg.fahr, sounds: cfg.sounds, calm: cfg.calm, walls: wallUrls(), defWalls: defWalls(), slide: cfg.slide, wallDefaults: cfg.wallDefaults,
  fontScale: cfg.fontScale, widgets: cfg.widgets, paired: cfg.tokens.length, platform: P,
  autostart: app.getLoginItemSettings(LOGIN()).openAtLogin }));
ipcMain.handle('cfg:set', (_, d) => {
  for (const k of SETTINGS) if (k in d) cfg[k] = d[k];
  if ('autostart' in d && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!d.autostart, ...LOGIN() });
  save(); broadcast();
});
ipcMain.handle('apps:save', async (_, d) => {
  let a = d.id && cfg.apps.find(x => x.id === d.id);
  if (!a) { a = { id: crypto.randomUUID() }; cfg.apps.push(a); }
  a.type = d.type === 'exe' ? 'exe' : 'web'; a.target = String(d.target).trim();
  if (a.type === 'web' && !/^https?:\/\//i.test(a.target)) a.target = 'https://' + a.target;
  a.engine = ['auto', 'builtin', 'edge'].includes(d.engine) ? d.engine : (a.engine || 'auto');
  a.name = String(d.name || '').trim() || a.target;
  if (!a.icon || d.iconMode !== 'keep') await makeIcon(a, d);
  save(); pushApps();
});
ipcMain.handle('apps:remove', (_, id) => {
  const a = cfg.apps.find(x => x.id === id); if (!a) return;
  if (a.icon) try { fs.unlinkSync(a.icon); } catch {}
  cfg.apps = cfg.apps.filter(x => x.id !== id); save(); pushApps();
});
ipcMain.handle('apps:move', (_, id, dir) => {
  const i = cfg.apps.findIndex(x => x.id === id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= cfg.apps.length) return;
  [cfg.apps[i], cfg.apps[j]] = [cfg.apps[j], cfg.apps[i]]; save(); pushApps();
});
ipcMain.handle('apps:launch', (_, id) => openApp(id));
ipcMain.handle('dlg:exe', async () => {
  const f = WIN ? [{ name: 'Programs', extensions: ['exe'] }] : MAC ? [{ name: 'Apps', extensions: ['app'] }] : [];
  const r = await dialog.showOpenDialog(launcher, { properties: ['openFile'], filters: f });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dlg:img', async () => {
  const r = await dialog.showOpenDialog(launcher, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('wall:pick', async () => {
  const r = await dialog.showOpenDialog(launcher, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (!r.canceled) {
    for (const src of r.filePaths) {
      const dest = path.join(WALLS, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + path.extname(src).toLowerCase());
      try { fs.copyFileSync(src, dest); cfg.walls.push(dest); } catch (e) { logErr(e); }
    }
    save();
  }
  return wallUrls();
});
ipcMain.handle('wall:clear', () => { for (const f of cfg.walls) try { fs.unlinkSync(f); } catch {} cfg.walls = []; save(); return []; });
ipcMain.handle('power', (_, k) => { if (['sleep', 'restart', 'shutdown'].includes(k)) power(k); });
ipcMain.handle('remote:info', async () => ({ url: remoteUrl, pin: PIN, paired: cfg.tokens.length,
  qr: await QRCode.toDataURL(remoteUrl || 'http://localhost', { margin: 1, width: 320 }) }));
ipcMain.handle('remote:unpair', () => { cfg.tokens = []; save(); if (wss) wss.clients.forEach(c => { c.authed = false; c.close(); }); send('remote', { paired: 0 }); });
ipcMain.handle('app:quit', () => app.quit());

app.on('second-instance', () => { if (!current) showLauncher(); });
app.on('will-quit', () => { try { psIn && psIn.kill(); psEsc && psEsc.kill(); } catch {} });
app.whenReady().then(() => {
  if (!gotLock) return;
  try { load(); createLauncher(); startPS(); startServer(); }
  catch (e) { logErr(e); dialog.showErrorBox('Lounge', 'Der Start ist fehlgeschlagen:\n' + ((e && e.message) || e)); app.quit(); }
});
