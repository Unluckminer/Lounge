const { app, BrowserWindow, ipcMain, dialog, nativeImage, screen, globalShortcut, shell, Tray, Menu, safeStorage } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const I18N = require('./renderer/i18n.js');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/* Der Programmname hat sich von "TV Launcher" zu "Lounge" geändert: vorhandene Daten (Apps, Konto, Hintergründe) weiter nutzen */
try { const old = path.join(app.getPath('appData'), 'TV Launcher'); if (fs.existsSync(old)) app.setPath('userData', old); } catch {}

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
const SETTINGS = ['cursorBig','cursorSize','shareActivity','city','lat','lon','escClose','deviceName','accent','theme','lang','onboarded','h24','fahr','sounds','calm','slide','slideSec','wallDefaults','fontScale','widgets','ctrlL'];
const MENU_KEY = 'Control+L';

let cfg = { apps: [], quick: [], city: '', lat: null, lon: null, escClose: true, tokens: [], deviceName: '', accent: '#0a84ff',
  theme: 'system', lang: '', onboarded: false, h24: true, fahr: false, sounds: false, calm: true, wall: null,
  walls: [], slide: true, slideSec: 20, wallDefaults: true, fontScale: 1, widgets: null, ctrlL: true,
  cursorBig: false, cursorSize: 2, shareActivity: true, layoutV: 0 };
let ACC = null, UPD = null;
let launcher = null, wss = null, lastEsc = 0, tray = null, menuWin = null, menuOpenedAt = 0;
let remoteUrl = '', PIN = newPin(), psIn = null, psEsc = null, CFG_FILE, ICONS, DATA, WALLS;

/* Laufende Aufgaben (Apps, die Lounge gestartet hat). Mehrere können gleichzeitig laufen, eine hat den Fokus. */
let tasks = [], focusId = null, loadingId = null, split = null;
const focused = () => tasks.find(t => t.id === focusId) || null;

/* ---------- Config ---------- */
function load() {
  DATA = app.getPath('userData'); CFG_FILE = path.join(DATA, 'config.json'); ICONS = path.join(DATA, 'icons');
  WALLS = path.join(DATA, 'wallpapers');
  fs.mkdirSync(ICONS, { recursive: true }); fs.mkdirSync(WALLS, { recursive: true });
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch {}
  /* altes einzelnes Hintergrundbild in die neue Liste übernehmen */
  if (!Array.isArray(cfg.walls)) cfg.walls = [];
  if (!Array.isArray(cfg.quick)) cfg.quick = [];
  if (cfg.wall) { if (fs.existsSync(cfg.wall) && !cfg.walls.includes(cfg.wall)) cfg.walls.push(cfg.wall); cfg.wall = null; }
  /* altes Widget-Format (nur Skalierung) wird durch das neue (freie Größe) ersetzt */
  if (Array.isArray(cfg.widgets) && cfg.widgets.some(w => w.w == null || w.h == null)) cfg.widgets = null;
  /* Version 1.4: größerer Widget-Bereich, Uhr/Datum/Gruß einzeln -> altes Layout einmalig zurücksetzen */
  if (cfg.layoutV !== 2) { cfg.widgets = null; cfg.layoutV = 2; }
  if (!cfg.lang) cfg.lang = I18N.pick(app.getLocale());
  if (!cfg.deviceName) cfg.deviceName = os.hostname();
}
const save = () => fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
const pub = a => ({ id: a.id, type: a.type, name: a.name, target: a.target, engine: a.engine || 'auto', color: a.color || null,
  icon: a.icon && fs.existsSync(a.icon) ? pathToFileURL(a.icon).href : null });
const send = (ch, d) => launcher && !launcher.isDestroyed() && launcher.webContents.send(ch, d);
const running = () => tasks.map(t => t.app.id);
const pushApps = () => { send('apps', { apps: cfg.apps.map(pub), quick: cfg.quick.map(pub), running: running() }); broadcast(); };
const sendRunning = () => send('running', running());
const wallUrls = () => cfg.walls.filter(f => fs.existsSync(f)).map(f => pathToFileURL(f).href + '?t=' + fs.statSync(f).mtimeMs);
/* Mitgelieferte Standard-Bilder: einfach Bilder in renderer/wallpapers/ legen, sie werden automatisch erkannt */
const defWalls = () => {
  try { return fs.readdirSync(path.join(__dirname, 'renderer', 'wallpapers')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort().map(f => 'wallpapers/' + f); } catch { return []; }
};
const T = k => I18N.t(cfg.lang, k);

/* ---------- Eingabe-Treiber (Windows: PowerShell, macOS: osascript/cliclick, Linux: xdotool) ---------- */
function startPS() {
  if (!WIN) return;
  const args = f => ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, f)];
  psIn = spawn('powershell.exe', args('input.ps1'), { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  psIn.stdin.on('error', () => {}); psIn.on('error', () => { psIn = null; }); psIn.on('exit', () => { psIn = null; });
  psEsc = spawn('powershell.exe', args('esc.ps1'), { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  psEsc.on('error', () => {});
  psEsc.stdout.on('data', d => { if (String(d).includes('ESC2') && focused() && cfg.escClose && !menuWin) closeTask(focused()); });
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
  for (const ev of ['show', 'hide', 'minimize', 'restore', 'focus']) launcher.on(ev, updateShortcut);
  launcher.on('restore', () => { if (!focused()) launcher.setFullScreen(true); });
}
function showLauncher() {
  if (launcher && !launcher.isDestroyed()) { if (launcher.isMinimized()) launcher.restore(); launcher.show(); launcher.setFullScreen(true); launcher.focus(); }
  updateShortcut();
}
const goBack = wc => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack());
const workArea = () => screen.getPrimaryDisplay().workArea;
function rectFor(mode) {
  const b = workArea(), hw = Math.floor(b.width / 2);
  if (mode === 'left') return { x: b.x, y: b.y, width: hw, height: b.height };
  if (mode === 'right') return { x: b.x + hw, y: b.y, width: b.width - hw, height: b.height };
  if (mode === 'window') { const w = Math.round(b.width * .78), h = Math.round(b.height * .78); return { x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2), width: w, height: h }; }
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

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

/* ---------- Aufgaben: starten, fokussieren, platzieren, beenden ---------- */
function addTask(a, mode) {
  const t = { id: crypto.randomUUID(), app: a, name: a.name, kind: 'exe', mode: mode || 'full', full: (mode || 'full') === 'full', pid: 0, side: null };
  tasks.push(t); return t;
}
function dropTask(t) {
  if (!tasks.includes(t)) return;
  tasks = tasks.filter(x => x !== t);
  if (split && (split.a === t.id || split.b === t.id)) { const o = tasks.find(x => x.id === (split.a === t.id ? split.b : split.a)); if (o) { o.side = null; } split = null; }
  if (loadingId === t.id) loadingId = null;
  if (focusId === t.id) { focusId = null; hideToast(); send('home'); showLauncher(); }
  sendRunning(); broadcast(); updateShortcut();
}
function killTask(t) {
  t.dying = true;
  const k = t.kill, w = t.win;
  if (w && !w.isDestroyed()) w.destroy();
  if (k) k(); else if (t.proc) killTree(t.proc);
}
function closeTask(t) { if (!t) return; killTask(t); dropTask(t); }
function hook(t, p) {
  t.proc = p; t.pid = p.pid;
  p.on('exit', () => { if (!t.dying && !t.restarting && t.proc === p) dropTask(t); });
  p.on('error', () => { if (!t.dying && t.proc === p) dropTask(t); });
}

function openApp(id, o = {}) {
  const a = cfg.apps.find(x => x.id === id); if (!a) return null;
  const have = tasks.find(t => t.app.id === a.id);
  if (have) { if (!o.split) focusTask(have); return have; }
  if (menuWin) hideMenu(true);
  const mode = o.split ? 'right' : 'full', t = addTask(a, mode);
  if (o.split) { t.side = 'right'; t.splitCb = o.split; } else { loadingId = t.id; send('launching', pub(a)); }
  let min = 1700, ready = () => true;
  try {
    if (a.type === 'web') {
      const b = pickBrowser(a);
      if (b) { launchBrowser(t, b, mode); min = 2100; } else { launchSite(t, a, mode); min = 1000; ready = () => t.ready; }
    } else launchExe(t, a);
  } catch (e) { logErr(e); dropTask(t); return null; }
  revealWhen(t, min, ready);
  sendRunning(); broadcast(); return t;
}
/* Erst wenn die App wirklich bereit ist (mindestens nach 1-2 Sekunden), wird sie im Vordergrund gezeigt – die Ladeanimation überbrückt die Zeit */
function revealWhen(t, minMs, isReady) {
  const t0 = Date.now();
  const check = () => {
    if (!tasks.includes(t) || t.dying) return;
    if (isReady() || Date.now() - t0 > 9000) setTimeout(() => reveal(t), Math.max(0, minMs - (Date.now() - t0)));
    else setTimeout(check, 120);
  };
  check();
}
function reveal(t) {
  if (!tasks.includes(t) || t.dying) return;
  if (t.splitCb) { const cb = t.splitCb; t.splitCb = null; cb(t); return; }
  if (loadingId === t.id) focusTask(t);
}
function raise(t) {
  if (!t) return;
  if (t.kind === 'site') { if (t.win && !t.win.isDestroyed()) { t.win.show(); t.win.focus(); } return; }
  if (WIN) ps('front ' + t.pid);
  else if (MAC) { const n = t.procName; if (n) osa(`tell application "${n.replace(/"/g, '')}" to activate`); else osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${t.pid}) to true`); }
  else run('sh', ['-c', `w=$(xdotool search --onlyvisible --pid ${t.pid} 2>/dev/null | tail -1); [ -n "$w" ] && xdotool windowactivate "$w"`]);
}
function focusTask(t, keepSplit) {
  if (!t || !tasks.includes(t)) return;
  focusId = t.id; if (loadingId === t.id) loadingId = null;
  if (menuWin) hideMenu(true);
  raise(t);
  setTimeout(() => {
    if (focusId !== t.id) return;
    if (launcher && !launcher.isDestroyed()) launcher.hide();
    if (t.kind !== 'site') raise(t);
    if (split && !keepSplit && (split.a === t.id || split.b === t.id)) { const o = tasks.find(x => x.id === (split.a === t.id ? split.b : split.a)); if (o) { raise(o); raise(t); } }
  }, t.kind === 'site' ? 30 : 300);
  announce(t); broadcast(); updateShortcut();
}
function goHome() {
  loadingId = null; focusId = null; hideToast(); send('home'); showLauncher(); broadcast();
}

function launchSite(t, a, mode) {
  const r = mode === 'full' ? null : rectFor(mode);
  const w = new BrowserWindow({ show: false, fullscreen: !r, ...(r || {}), frame: true, backgroundColor: '#000', autoHideMenuBar: true,
    webPreferences: { partition: 'persist:sites', sandbox: true } });
  t.kind = 'site'; t.win = w; const wc = w.webContents;
  wc.setUserAgent(UA);
  wc.setWindowOpenHandler(({ url }) => { wc.loadURL(url); return { action: 'deny' }; });
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.alt && i.key === 'ArrowLeft') { goBack(wc); e.preventDefault(); }
    if (i.key === 'Escape' && cfg.escClose) { const n = Date.now(); if (n - lastEsc < 700) { lastEsc = 0; closeTask(t); } else lastEsc = n; }
  });
  w.once('ready-to-show', () => { t.ready = true; });
  w.on('closed', () => { t.win = null; if (!t.dying) dropTask(t); });
  w.loadURL(a.target);
}
function browserArgs(t, b, mode) {
  const a = t.app, r = mode !== 'full' ? rectFor(mode) : null;
  const args = r ? ['--app=' + a.target, `--window-position=${r.x},${r.y}`, `--window-size=${r.width},${r.height}`]
    : ['--kiosk', a.target].concat(b.edge ? ['--edge-kiosk-type=fullscreen'] : []);
  return args.concat(['--user-data-dir=' + path.join(DATA, b.edge ? 'edge-profile' : 'chrome-profile'),
    '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble', '--autoplay-policy=no-user-gesture-required']);
}
function launchBrowser(t, b, mode) {
  t.kind = 'browser'; t.browser = b;
  hook(t, spawn(b.exe, browserArgs(t, b, mode), { stdio: 'ignore', detached: !WIN }));
}
function relaunchBrowser(t, mode) {
  t.restarting = true; const old = t.proc; killTree(old);
  setTimeout(() => { if (!tasks.includes(t) || t.dying) return; t.restarting = false; launchBrowser(t, t.browser, mode); setTimeout(() => focused() && raise(focused()), 900); }, 800);
}
function launchExe(t, a) {
  if (MAC && /\.app\/?$/i.test(a.target)) {
    const n = path.basename(a.target.replace(/\/$/, ''), '.app'); t.procName = n;
    hook(t, spawn('open', ['-W', '-a', a.target].concat(a.args && a.args.length ? ['--args', ...a.args] : []), { stdio: 'ignore' }));
    t.kill = () => osa(`tell application "${n.replace(/"/g, '')}" to quit`); return;
  }
  hook(t, spawn(a.target, a.args || [], { cwd: path.dirname(a.target), stdio: 'ignore', detached: !WIN }));
}
function placeExe(t, mode) {
  const r = rectFor(mode);
  if (WIN) {
    if (mode === 'full') return ps(`place ${t.pid} max`);
    const s = screen.dipToScreenRect(null, r); ps(`place ${t.pid} rect ${s.x} ${s.y} ${s.width} ${s.height}`);
  } else if (MAC) {
    const who = t.procName ? `process "${t.procName.replace(/"/g, '')}"` : `(first process whose unix id is ${t.pid})`;
    osa(`tell application "System Events" to tell ${who} to tell window 1 to set {position, size} to {{${r.x}, ${r.y}}, {${r.width}, ${r.height}}}`);
  } else run('sh', ['-c', `w=$(xdotool search --onlyvisible --pid ${t.pid} 2>/dev/null | tail -1); [ -z "$w" ] && w=$(xdotool getactivewindow); xdotool windowsize "$w" ${r.width} ${r.height} windowmove "$w" ${r.x} ${r.y} windowactivate "$w"`]);
}
function placeTask(t, mode) {
  const was = t.mode; t.mode = mode; t.full = mode === 'full';
  if (t.kind === 'site') {
    const w = t.win; if (!w || w.isDestroyed()) return;
    if (mode === 'full') w.setFullScreen(true);
    else { const r = rectFor(mode); if (w.isFullScreen()) { w.setFullScreen(false); setTimeout(() => !w.isDestroyed() && w.setBounds(r), 450); } else w.setBounds(r); }
  } else if (t.kind === 'browser') { if (was !== mode) relaunchBrowser(t, mode); }
  else placeExe(t, mode);
}
function toggleFull(t) {
  if (!t) return;
  if (split) return endSplit();
  placeTask(t, t.full ? 'window' : 'full');
  toast({ t: T(t.full ? 'mFullOn' : 'mFullDone'), s: t.name, ms: 2200 });
}
function startSplit(appId) {
  const A = focused(); if (!A) return;
  const finish = B => {
    if (!tasks.includes(A) || !tasks.includes(B)) return;
    A.side = 'left'; B.side = 'right'; split = { a: A.id, b: B.id };
    placeTask(A, 'left'); placeTask(B, 'right');
    focusId = B.id; if (launcher && !launcher.isDestroyed()) launcher.hide();
    setTimeout(() => { raise(A); raise(B); }, 500);
    toast({ t: T('mSplit'), s: A.name + '  |  ' + B.name, ms: 2800, keys: ['Strg', 'L'] }); broadcast(); updateShortcut();
  };
  const have = tasks.find(t => t.app.id === appId);
  if (have && have !== A) finish(have); else if (!have) openApp(appId, { split: finish });
}
function endSplit() {
  if (!split) return;
  const A = tasks.find(t => t.id === split.a), B = tasks.find(t => t.id === split.b); split = null;
  for (const t of [A, B]) if (t) { t.side = null; placeTask(t, 'full'); }
  if (A) focusTask(A); else if (B) focusTask(B);
}

/* ---------- Overlay: Hinweise (Toast) und Strg+L-Menü ---------- */
let toastWin = null, toastReady = false, toastQ = null, toastT = null;
function ensureToast() {
  if (toastWin && !toastWin.isDestroyed()) return;
  const b = screen.getPrimaryDisplay().bounds, w = 680, h = 120;
  toastReady = false;
  toastWin = new BrowserWindow({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + 40, width: w, height: h, transparent: true, frame: false, resizable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  toastWin.setIgnoreMouseEvents(true); toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.loadFile(path.join(__dirname, 'renderer', 'toast.html'));
  toastWin.webContents.once('did-finish-load', () => { toastReady = true; if (toastQ) { const q = toastQ; toastQ = null; toast(q); } });
  toastWin.on('closed', () => { toastWin = null; toastReady = false; });
}
function toast(p) {
  ensureToast();
  if (!toastReady) { toastQ = p; return; }
  toastWin.webContents.send('toast', Object.assign({ lang: cfg.lang, ms: 5000 }, p));
  toastWin.showInactive(); toastWin.setAlwaysOnTop(true, 'screen-saver');
  clearTimeout(toastT); toastT = setTimeout(() => { if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); }, (p.ms || 5000) + 600);
}
function hideToast() { clearTimeout(toastT); if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); }
function announce(t) {
  const canEsc = cfg.escClose && (WIN || t.kind === 'site');
  toast({ t: t.name, s: (canEsc ? T('hEsc') + '  ·  ' : '') + (cfg.ctrlL ? T('hMenu') : T('hBack')), keys: canEsc ? ['Esc', 'Esc'] : null, ms: 6500 });
}
function menuData() {
  const f = focused();
  return { lang: cfg.lang, theme: cfg.theme, dark: cfg.theme === 'dark' || (cfg.theme === 'system' && require('electron').nativeTheme.shouldUseDarkColors), accent: cfg.accent,
    focused: f ? { id: f.id, name: f.name, full: f.full } : null, split: !!split,
    tasks: tasks.map(t => ({ id: t.id, name: t.name, color: t.app.color, icon: pub(t.app).icon, focused: t.id === focusId })),
    apps: cfg.apps.map(a => ({ ...pub(a), running: tasks.some(t => t.app.id === a.id) })) };
}
let menuFocused = false, menuLast = 0;
const MENU_NAV = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Return: 'Enter', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete' };
function toggleMenu() {
  /* Entprellen: Strg+L kann doppelt ankommen (Tastenwiederholung, Handy + Tastatur) */
  const n = Date.now(); if (n - menuLast < 350) return; menuLast = n;
  try { if (menuWin && !menuWin.isDestroyed()) hideMenu(); else showMenu(); } catch (e) { logErr(e); menuWin = null; unregNav(); }
}
/* Die Pfeil-/Enter-/Esc-Tasten werden, solange das Menü offen ist, global abgefangen und ans Menü weitergereicht.
   So funktioniert die Bedienung auch dann, wenn Windows dem Menüfenster den Fokus nicht gibt (die andere App bleibt im Fokus). */
function regNav() {
  for (const k of Object.keys(MENU_NAV)) { try { globalShortcut.register(k, () => { if (menuWin && !menuWin.isDestroyed()) menuWin.webContents.send('key', MENU_NAV[k]); }); } catch {} }
}
function unregNav() { for (const k of Object.keys(MENU_NAV)) { try { globalShortcut.unregister(k); } catch {} } }
function showMenu() {
  if (menuWin && !menuWin.isDestroyed()) return;
  hideToast();
  const b = screen.getPrimaryDisplay().bounds, w = Math.min(1180, b.width - 40), h = 420;
  menuFocused = false; menuOpenedAt = Date.now();
  const win = menuWin = new BrowserWindow({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - h, width: w, height: h, transparent: true, frame: false, resizable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('focus', () => { menuFocused = true; });
  /* nur schließen, wenn das Fenster den Fokus wirklich hatte und ihn danach verliert (Klick auf eine andere App) */
  win.on('blur', () => { if (menuFocused && Date.now() - menuOpenedAt > 600) hideMenu(); });
  win.on('closed', () => { if (menuWin === win) { menuWin = null; unregNav(); } });
  win.webContents.on('render-process-gone', () => { if (menuWin === win) hideMenu(); });
  win.loadFile(path.join(__dirname, 'renderer', 'menu.html')).catch(e => logErr(e));
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    try { win.webContents.send('data', menuData()); win.showInactive(); win.moveTop(); win.focus(); } catch (e) { logErr(e); }
  });
  regNav(); updateShortcut();
}
function hideMenu(noRefocus) {
  const w = menuWin; menuWin = null; unregNav();
  try { if (w && !w.isDestroyed()) w.destroy(); } catch (e) { logErr(e); }
  if (!noRefocus) { try { const f = focused(); if (f) raise(f); else if (launcher && !launcher.isDestroyed() && launcher.isVisible()) launcher.focus(); } catch (e) { logErr(e); } }
  updateShortcut();
}
function menuAct(a, arg) {
  try { menuAct2(a, arg); } catch (e) { logErr(e); }
}
function menuAct2(a, arg) {
  const f = focused();
  switch (a) {
    case 'close': hideMenu(); break;
    case 'home': hideMenu(true); goHome(); break;
    case 'task': { const t = tasks.find(x => x.id === arg); hideMenu(true); if (t) focusTask(t); break; }
    case 'full': hideMenu(); toggleFull(f); break;
    case 'split': hideMenu(true); startSplit(String(arg)); break;
    case 'unsplit': hideMenu(true); endSplit(); break;
    case 'closeApp': hideMenu(true); closeTask(f); break;
    case 'closeTask': { const t = tasks.find(x => x.id === arg); if (t) closeTask(t); if (menuWin) menuWin.webContents.send('data', menuData()); break; }
    case 'quit': app.quit(); break;
  }
}
function updateShortcut() {
  try {
    const visible = launcher && !launcher.isDestroyed() && launcher.isVisible() && !launcher.isMinimized();
    /* Strg+L wird nur beansprucht, solange Lounge im Vordergrund ist oder eine Lounge-App läuft – so bleibt es in normalen Programmen (z. B. Adressleiste im Browser) frei */
    const want = cfg.ctrlL && (visible || focused() || menuWin);
    const have = globalShortcut.isRegistered(MENU_KEY);
    if (want && !have) globalShortcut.register(MENU_KEY, toggleMenu);
    else if (!want && have) globalShortcut.unregister(MENU_KEY);
  } catch (e) { logErr(e); }
}

/* ---------- Schnellstart: normale Programme, ohne Vollbild und ohne Lounge-Kontrolle ---------- */
function quickLaunch(id) {
  const q = cfg.quick.find(x => x.id === id); if (!q) return;
  try {
    if (MAC && /\.app\/?$/i.test(q.target)) spawn('open', ['-a', q.target].concat(q.args && q.args.length ? ['--args', ...q.args] : []), { stdio: 'ignore', detached: true }).unref();
    else { const p = spawn(q.target, q.args || [], { cwd: path.dirname(q.target), stdio: 'ignore', detached: true }); p.on('error', () => shell.openPath(q.target)); p.unref(); }
  } catch { shell.openPath(q.target); }
  setTimeout(() => { if (launcher && !launcher.isDestroyed() && !focused()) { launcher.minimize(); updateShortcut(); } }, 700);
  setTimeout(() => toast({ t: q.name, s: T('qBack'), ms: 4500 }), 1200);
}

/* ---------- Programme finden: laufende und installierte ---------- */
const ex = (cmd, args, ms = 9000) => new Promise(res => {
  try { const p = spawn(cmd, args, { windowsHide: true }); let o = ''; p.stdout.on('data', d => { o += d; }); p.on('error', () => res('')); p.on('close', () => res(o)); setTimeout(() => { try { p.kill(); } catch {} }, ms); }
  catch { res(''); }
});
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const SELF = () => [process.execPath, process.env.PORTABLE_EXECUTABLE_FILE].filter(Boolean).map(s => s.toLowerCase());
async function runningPrograms() {
  let out = [];
  if (WIN) {
    const cmd = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | ForEach-Object { $d=$null; try { $d=$_.MainModule.FileVersionInfo.FileDescription } catch {}; [pscustomobject]@{ n=$_.ProcessName; p=$_.Path; t=$_.MainWindowTitle; d=$d } } | ConvertTo-Json -Compress";
    const raw = (await ex('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd])).trim();
    try { let j = JSON.parse(raw || '[]'); if (!Array.isArray(j)) j = [j]; out = j.map(x => ({ name: (x.d || x.n || '').trim() || x.n, target: x.p, sub: x.t || '' })); } catch {}
    out = out.filter(x => !/\\windows\\(system32|systemapps|immersivecontrolpanel|explorer\.exe)/i.test(x.target) && !/applicationframehost|textinputhost|searchhost|startmenuexperiencehost|shellexperiencehost|lockapp/i.test(x.target));
  } else if (MAC) {
    const raw = (await ex('osascript', ['-e', 'tell application "System Events" to get {name, POSIX path of application file} of (every process whose background only is false)'])).trim();
    const parts = raw.split(', ').map(s => s.trim()).filter(Boolean), n = Math.floor(parts.length / 2);
    for (let i = 0; i < n; i++) out.push({ name: parts[i], target: parts[n + i].replace(/\/$/, ''), sub: '' });
    out = out.filter(x => !/^(Finder|Lounge|TV Launcher|Dock)$/i.test(x.name));
  } else {
    const raw = await ex('wmctrl', ['-lp']), seen = new Set();
    for (const l of raw.split('\n')) {
      const m = l.match(/^\S+\s+\S+\s+(\d+)\s+\S+\s+(.*)$/); if (!m) continue;
      try {
        const exe = fs.readlinkSync(`/proc/${m[1]}/exe`); if (seen.has(exe)) continue; seen.add(exe);
        out.push({ name: path.basename(exe).replace(/[-_]bin$/, '').replace(/^./, c => c.toUpperCase()), target: exe, sub: m[2] });
      } catch {}
    }
    if (!out.length) {
      const skip = /systemd|dbus|pipewire|pulse|gnome-shell|gnome-session|xdg-|gvfs|at-spi|ibus|Xwayland|Xorg|kwin|plasma|gsd-|evolution-|tracker|nautilus-|snapd|appimaged/i;
      try {
        for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
          try {
            const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8'); if (!/(^|\0)(DISPLAY|WAYLAND_DISPLAY)=/.test(env)) continue;
            const exe = fs.readlinkSync(`/proc/${pid}/exe`); if (seen.has(exe) || skip.test(exe) || !/^\/(usr|opt|snap|app)/.test(exe)) continue; seen.add(exe);
            out.push({ name: path.basename(exe).replace(/^./, c => c.toUpperCase()), target: exe, sub: '' });
          } catch {}
        }
      } catch {}
    }
  }
  const me = SELF(), seen2 = new Set();
  return out.filter(x => x.target && !me.includes(x.target.toLowerCase()) && !seen2.has(x.target) && seen2.add(x.target)).sort((a, b) => a.name.localeCompare(b.name));
}
let installedCache = null, installedAt = 0;
function walk(dir, depth, fn) {
  let l = []; try { l = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of l) { const f = path.join(dir, d.name); if (d.isDirectory()) { if (depth > 0) walk(f, depth - 1, fn); } else fn(f); }
}
const BAD = /uninstall|deinstall|readme|help|manual|documentation|license|website|release notes|setup|update|repair|configure|configuration|\bdocs?\b/i;
function installedPrograms() {
  if (installedCache && Date.now() - installedAt < 300000) return installedCache;
  const out = [], seen = new Set();
  const add = (name, target, extra) => { if (!name || !target || seen.has(target) || BAD.test(name)) return; seen.add(target); out.push(Object.assign({ name, target, sub: '' }, extra)); };
  if (WIN) {
    for (const base of [process.env.ProgramData, process.env.APPDATA].filter(Boolean))
      walk(path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 3, f => {
        if (!/\.lnk$/i.test(f)) return;
        try { const t = shell.readShortcutLink(f).target; if (t && /\.exe$/i.test(t) && fs.existsSync(t)) add(path.basename(f, '.lnk'), t); } catch {}
      });
  } else if (MAC) {
    for (const dir of ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')])
      try { for (const f of fs.readdirSync(dir)) if (/\.app$/i.test(f)) add(f.replace(/\.app$/i, ''), path.join(dir, f)); } catch {}
  } else {
    const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', '/var/lib/snapd/desktop/applications'];
    const findIcon = n => {
      if (!n) return null; if (path.isAbsolute(n)) return fs.existsSync(n) && !/\.svg$/i.test(n) ? n : null;
      for (const s of ['256x256', '128x128', '96x96', '64x64', '48x48']) { const f = `/usr/share/icons/hicolor/${s}/apps/${n}.png`; if (fs.existsSync(f)) return f; }
      const f = `/usr/share/pixmaps/${n}.png`; return fs.existsSync(f) ? f : null;
    };
    for (const d of dirs) walk(d, 0, f => {
      if (!/\.desktop$/i.test(f)) return;
      let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
      const sec = txt.split(/\n\[/)[0], g = k => { const m = sec.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
      if (g('NoDisplay') === 'true' || g('Hidden') === 'true' || g('Terminal') === 'true' || (g('Type') && g('Type') !== 'Application')) return;
      const tok = (g('Exec').match(/"[^"]*"|\S+/g) || []).map(s => s.replace(/^"|"$/g, '')).filter(s => !/^%/.test(s));
      if (!tok.length) return;
      add(g('Name'), tok[0], { args: tok.slice(1), iconFile: findIcon(g('Icon')) });
    });
  }
  installedCache = out; installedAt = Date.now(); return out;
}
async function withIcons(list) {
  await Promise.all(list.map(async it => {
    try {
      if (it.iconFile) it.icon = pathToFileURL(it.iconFile).href;
      else if (WIN || MAC) { const im = await app.getFileIcon(it.target, { size: 'normal' }); if (!im.isEmpty()) it.icon = im.toDataURL(); }
    } catch {}
  }));
  return list;
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
const stateMsg = () => { const f = focused(); return JSON.stringify({ t: 'state', mode: f ? f.app.type : 'launcher', name: f ? f.name : null,
  lang: cfg.lang, device: cfg.deviceName, accent: cfg.accent, theme: cfg.theme, tasks: tasks.length,
  apps: cfg.apps.map(a => ({ id: a.id, name: a.name, icon: a.icon ? '/icon/' + a.id + '?v=' + encodeURIComponent(path.basename(a.icon)) : null })) }); };
/* Live-Status für Freunde: was gerade im Vordergrund läuft */
function activityText() {
  const f = focused(); if (!f) return null;
  if (f.app.type === 'web') { try { return new URL(f.app.target).hostname.replace(/^www\./, ''); } catch {} }
  return f.name;
}
const updatePresence = () => { try { ACC && ACC.setActivity(activityText(), cfg.shareActivity); } catch {} };

/* Fernbedienungsmodus: sobald das Handy die Maus bewegt, gilt er für ~15 s. Dann (wenn aktiviert) großer Mauszeiger. */
let remoteMouse = false, remoteMouseT = 0, cursorApplied = false;
const cursorPx = () => Math.max(32, Math.min(256, Math.round(32 * (cfg.cursorSize || 2) / 16) * 16));
function applyCursor() {
  const on = !!cfg.cursorBig && remoteMouse;
  send('remoteMode', { on, size: cfg.cursorSize || 2 });
  if (WIN) {
    if (on) { ps('cursor ' + cursorPx()); cursorApplied = true; }
    else if (cursorApplied) { ps('cursor reset'); cursorApplied = false; }
  }
}
function touchRemote() {
  if (!remoteMouse) { remoteMouse = true; applyCursor(); }
  clearTimeout(remoteMouseT); remoteMouseT = setTimeout(() => { remoteMouse = false; applyCursor(); }, 15000);
}
function broadcast() {
  updatePresence(); if (!wss) return; const s = stateMsg(); wss.clients.forEach(c => c.authed && c.readyState === 1 && c.send(s)); }
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
  else if (m.pin && String(m.pin) === PIN) { token = crypto.randomBytes(24).toString('hex'); cfg.tokens.push(token); save(); PIN = newPin(); send('remote', { paired: cfg.tokens.length }); toast({ t: T('rPaired'), s: cfg.deviceName, ms: 3000 }); }
  if (token) { fails.delete(ws.ip); ws.authed = true; ws.send(JSON.stringify({ t: 'auth', ok: true, token })); ws.send(stateMsg()); }
  else { if (++f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ws.ip, f); ws.send(JSON.stringify({ t: 'auth', ok: false })); }
}
function handle(m) {
  const f = focused();
  switch (m.t) {
    case 'key': if (KEYS.has(m.k)) input.key(m.k); break;
    case 'combo': if (m.k === 'alttab' || m.k === 'altf4') input.combo(m.k); break;
    case 'text': input.text(String(m.v).slice(0, 300)); break;
    case 'move': touchRemote(); input.move(m.dx | 0, m.dy | 0); break;
    case 'click': touchRemote(); input.click(m.b === 'r' ? 'r' : 'l'); break;
    case 'scroll': touchRemote(); input.scroll(m.d | 0); break;
    case 'back': if (menuWin) hideMenu(); else if (f && f.kind === 'site' && f.win && !f.win.isDestroyed()) goBack(f.win.webContents); else if (f && f.kind === 'browser') input.combo('altleft'); else input.key('Esc'); break;
    case 'home': goHome(); break;
    case 'close': if (f) closeTask(f); else goHome(); break;
    case 'menu': toggleMenu(); break;
    case 'launch': openApp(String(m.id)); break;
    case 'hint': if (f) announce(f); break;
    case 'power': if (['sleep', 'restart', 'shutdown'].includes(m.k)) power(m.k); break;
  }
}

/* ---------- IPC ---------- */
/* Die portable .exe entpackt sich in einen Temp-Ordner: für den Autostart muss die echte .exe-Datei verwendet werden */
const LOGIN = () => (process.env.PORTABLE_EXECUTABLE_FILE ? { path: process.env.PORTABLE_EXECUTABLE_FILE } : {});
ipcMain.handle('cfg:get', () => ({ apps: cfg.apps.map(pub), quick: cfg.quick.map(pub), running: running(), city: cfg.city, lat: cfg.lat, lon: cfg.lon, escClose: cfg.escClose,
  deviceName: cfg.deviceName, accent: cfg.accent, theme: cfg.theme, lang: cfg.lang, onboarded: cfg.onboarded, h24: cfg.h24,
  fahr: cfg.fahr, sounds: cfg.sounds, calm: cfg.calm, walls: wallUrls(), defWalls: defWalls(), slide: cfg.slide, slideSec: cfg.slideSec, wallDefaults: cfg.wallDefaults,
  fontScale: cfg.fontScale, widgets: cfg.widgets, ctrlL: cfg.ctrlL, cursorBig: cfg.cursorBig, cursorSize: cfg.cursorSize, shareActivity: cfg.shareActivity,
  account: ACC ? ACC.state() : { configured: false }, version: app.getVersion(), update: UPD ? UPD.state() : null, paired: cfg.tokens.length, platform: P,
  autostart: app.getLoginItemSettings(LOGIN()).openAtLogin }));
ipcMain.handle('cfg:set', (_, d) => {
  for (const k of SETTINGS) if (k in d) cfg[k] = d[k];
  if ('autostart' in d && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!d.autostart, ...LOGIN() });
  save(); broadcast(); if ('ctrlL' in d) updateShortcut(); if ('cursorBig' in d || 'cursorSize' in d) applyCursor();
});
ipcMain.handle('apps:save', async (_, d) => {
  const list = d.quick ? cfg.quick : cfg.apps;
  let a = d.id && list.find(x => x.id === d.id);
  if (!a) { a = { id: crypto.randomUUID() }; list.push(a); }
  a.type = (d.quick || d.type === 'exe') ? 'exe' : 'web'; a.target = String(d.target).trim();
  if (a.type === 'web' && !/^https?:\/\//i.test(a.target)) a.target = 'https://' + a.target;
  if (a.type === 'exe') a.args = Array.isArray(d.args) ? d.args.map(String) : (a.args || []);
  a.engine = ['auto', 'builtin', 'edge'].includes(d.engine) ? d.engine : (a.engine || 'auto');
  a.name = String(d.name || '').trim() || (a.type === 'exe' ? path.basename(a.target).replace(/\.(exe|app)$/i, '') : a.target);
  if (!a.icon || d.iconMode !== 'keep') await makeIcon(a, d);
  save(); pushApps();
});
ipcMain.handle('apps:remove', (_, id, quick) => {
  const list = quick ? cfg.quick : cfg.apps, a = list.find(x => x.id === id); if (!a) return;
  if (a.icon) try { fs.unlinkSync(a.icon); } catch {}
  const t = tasks.find(x => x.app.id === id); if (t && !quick) closeTask(t);
  if (quick) cfg.quick = cfg.quick.filter(x => x.id !== id); else cfg.apps = cfg.apps.filter(x => x.id !== id);
  save(); pushApps();
});
ipcMain.handle('apps:move', (_, id, dir, quick) => {
  const list = quick ? cfg.quick : cfg.apps, i = list.findIndex(x => x.id === id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]]; save(); pushApps();
});
ipcMain.handle('apps:launch', (_, id) => openApp(id));
ipcMain.handle('apps:close', (_, id) => { const t = tasks.find(x => x.app.id === id); if (t) closeTask(t); });
ipcMain.handle('quick:launch', (_, id) => quickLaunch(id));
ipcMain.handle('programs:list', async () => {
  const run1 = await runningPrograms(), have = new Set(run1.map(x => x.target));
  const sug = shuffle(installedPrograms().filter(x => !have.has(x.target)).slice()).slice(0, 14).map(x => ({ ...x }));
  await Promise.all([withIcons(run1), withIcons(sug)]);
  return { running: run1, suggest: sug };
});
ipcMain.handle('dlg:exe', async () => {
  const f = WIN ? [{ name: 'Programs', extensions: ['exe', 'lnk'] }] : MAC ? [{ name: 'Apps', extensions: ['app'] }] : [];
  const r = await dialog.showOpenDialog(launcher, { properties: ['openFile'], filters: f });
  if (r.canceled) return null;
  let p = r.filePaths[0];
  if (WIN && /\.lnk$/i.test(p)) { try { const t = shell.readShortcutLink(p).target; if (t) p = t; } catch {} }
  return p;
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
ipcMain.handle('menu:toggle', () => toggleMenu());
ipcMain.handle('toast', (_, p) => toast({ t: String(p.t || ''), s: String(p.s || ''), ms: Math.min(+p.ms || 4000, 12000) }));
ipcMain.handle('menu:act', (_, a, arg) => menuAct(a, arg));
/* Systeminfo für das System-Widget (CPU-Last aus der Differenz der CPU-Zeiten) */
let lastCpu = null;
ipcMain.handle('sys:info', () => {
  const cpus = os.cpus(), cur = cpus.reduce((s, c) => { const t = Object.values(c.times).reduce((a, b) => a + b, 0); return { idle: s.idle + c.times.idle, total: s.total + t }; }, { idle: 0, total: 0 });
  let load = 0; if (lastCpu) { const di = cur.idle - lastCpu.idle, dt = cur.total - lastCpu.total; load = dt > 0 ? 1 - di / dt : 0; } lastCpu = cur;
  return { cpu: Math.max(0, Math.min(1, load)), mem: 1 - os.freemem() / os.totalmem(), memTotal: os.totalmem(), up: os.uptime(), cores: cpus.length };
});

/* Konto, Freunde, News */
const accWrap = fn => async (_, ...a) => { try { return await fn(...a); } catch (e) { logErr(e); return { error: 'err', detail: String((e && e.message) || e) }; } };
ipcMain.handle('acc:state', () => ACC.state());
ipcMain.handle('acc:signUp', accWrap(d => ACC.signUp(d)));
ipcMain.handle('acc:signIn', accWrap(d => ACC.signIn(d)));
ipcMain.handle('acc:google', accWrap(() => ACC.google()));
ipcMain.handle('acc:username', accWrap(n => ACC.setUsername(n)));
ipcMain.handle('acc:signOut', accWrap(() => ACC.signOut()));
ipcMain.handle('acc:friends', accWrap(() => ACC.friends()));
ipcMain.handle('acc:search', accWrap(q => ACC.search(q)));
ipcMain.handle('acc:add', accWrap(n => ACC.add(n)));
ipcMain.handle('acc:accept', accWrap(id => ACC.accept(id)));
ipcMain.handle('acc:remove', accWrap(id => ACC.remove(id)));
ipcMain.handle('news:list', accWrap(() => ACC.news()));
ipcMain.handle('news:open', (_, id) => id);
ipcMain.handle('update:state', () => UPD.state());
ipcMain.handle('update:check', () => UPD.check());
ipcMain.handle('update:install', () => UPD.install());

let quitting = false;
app.on('before-quit', e => {
  if (quitting) return;
  if (cursorApplied || (ACC && ACC.state().signedIn)) {
    e.preventDefault(); quitting = true;
    if (cursorApplied) { ps('cursor reset'); cursorApplied = false; }
    Promise.race([ACC ? ACC.goOffline() : null, new Promise(r => setTimeout(r, 1500))]).catch(() => {}).finally(() => setTimeout(() => app.quit(), 450));
  }
});
app.on('second-instance', () => { if (!focused()) showLauncher(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); psIn && psIn.kill(); psEsc && psEsc.kill(); tasks.forEach(t => { t.dying = true; if (t.win && !t.win.isDestroyed()) t.win.destroy(); if (t.kill) t.kill(); else if (t.proc) killTree(t.proc); }); } catch {} });
app.whenReady().then(() => {
  if (!gotLock) return;
  try {
    load(); ACC = require('./account.js')({ app, shell, safeStorage, log: logErr, onChange: () => send('account', ACC.state()) });
    UPD = require('./updater.js')({ app, shell, send, toast, T, log: logErr });
    createLauncher(); startPS(); startServer(); updateShortcut(); ACC.init().catch(logErr); UPD.start();
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')).resize({ width: 18, height: 18 }));
      tray.setToolTip('Lounge'); tray.on('click', () => { goHome(); });
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Lounge', click: () => goHome() }, { type: 'separator' }, { label: T('quit'), click: () => app.quit() }]));
    } catch (e) { logErr(e); }
  } catch (e) { logErr(e); dialog.showErrorBox('Lounge', 'Der Start ist fehlgeschlagen:\n' + ((e && e.message) || e)); app.quit(); }
});
