const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let cfg = { apps: [], lang: 'en', theme: 'system', accent: '#0a84ff', h24: true, walls: [], defWalls: [], slide: true, wallDefaults: true, fontScale: 1, widgets: null }, editing = false, wxHtml = '', calKey = '', modalEl = null, modalId = null, prevFocus = null, AC = null;
const T = k => I18N.t(cfg.lang, k);
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#40c8e0', '#ffd60a', '#ac8e68'];
const mq = matchMedia('(prefers-color-scheme: dark)');

/* ---------- Darstellung ---------- */
const colorOf = a => a.color ? `rgb(${a.color.join(',')})` : `hsl(${Math.abs([...a.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 360} 50% 45%)`;
const idleBg = () => [cfg.accent, `color-mix(in srgb, ${cfg.accent} 45%, #6a3cff)`];
function setBg(c1, c2) { const s = document.documentElement.style; s.setProperty('--c1', c1); s.setProperty('--c2', c2 || `color-mix(in srgb, ${c1} 40%, #5a3cff)`); }
function applyTheme() {
  const r = document.documentElement, dark = cfg.theme === 'system' ? mq.matches : cfg.theme === 'dark';
  r.dataset.theme = dark ? 'dark' : 'light';
  r.style.setProperty('--accent', cfg.accent); r.style.setProperty('--ar', [1, 3, 5].map(i => parseInt(cfg.accent.slice(i, i + 2), 16)).join(','));
  r.style.setProperty('--fs', cfg.fontScale || 1);
  document.body.classList.toggle('still', !cfg.calm);
  if (!document.activeElement?.closest?.('.tile:not(.add)')) setBg(...idleBg());
}
function applyLang() {
  const r = document.documentElement; r.lang = cfg.lang; r.dir = I18N.dir(cfg.lang);
  $$('[data-i]').forEach(e => { e.textContent = T(e.dataset.i); });
  $('#gear').setAttribute('aria-label', T('settings'));
  $('#dev span').textContent = cfg.deviceName || '';
  $('#editHint').textContent = T('editHint'); $('#eAdd').textContent = '+ ' + T('addWidget'); $('#eReset').textContent = T('resetLayout'); $('#eDone').textContent = T('done');
  renderZone(); weather(); render(); pill();
}
mq.addEventListener('change', applyTheme);

/* ---------- Slideshow (Hintergrund) ---------- */
const SLIDE_MS = 60000;
let slideT = 0, slideList = [], slideIdx = 0, slideFront = 0;
const wallSources = () => [...(cfg.walls || []), ...(cfg.wallDefaults !== false ? (cfg.defWalls || []) : [])];
function showWall(url, fast) {
  const els = [$('#wall'), $('#wall2')], nxt = els[1 - slideFront], cur = els[slideFront], img = new Image();
  img.onload = () => {
    nxt.style.transitionDuration = fast ? '1.2s' : ''; nxt.style.backgroundImage = `url("${url}")`;
    nxt.classList.add('on'); cur.classList.remove('on'); slideFront = 1 - slideFront;
  };
  img.onerror = () => { if (slideList.length > 1) setTimeout(nextWall, 500); };
  img.src = url;
}
function nextWall() { if (slideList.length < 2) return; slideIdx = (slideIdx + 1) % slideList.length; showWall(slideList[slideIdx]); }
function wallStart() {
  clearInterval(slideT);
  const list = wallSources(), same = JSON.stringify(list) === JSON.stringify(slideList);
  document.body.classList.toggle('has-wall', list.length > 0);
  slideList = list;
  if (!list.length) { $$('.wl').forEach(e => { e.classList.remove('on'); e.style.backgroundImage = 'none'; }); return; }
  if (!same || !$('.wl.on')) { slideIdx = cfg.slide ? Math.floor(Math.random() * list.length) : 0; showWall(list[slideIdx], true); }
  else if (!cfg.slide) { slideIdx = 0; showWall(list[0], true); }
  if (cfg.slide && list.length > 1) slideT = setInterval(nextWall, SLIDE_MS);
}

/* ---------- Widgets ---------- */
const defaultWidgets = () => [{ id: 'clock', type: 'clock', x: 0, y: 0, s: 1 }, { id: 'weather', type: 'weather', x: 66, y: 2, s: 1 }];
const widgets = () => cfg.widgets || defaultWidgets();
const wById = id => widgets().find(w => w.id === id);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const commit = () => { if (!cfg.widgets) cfg.widgets = defaultWidgets(); return save({ widgets: cfg.widgets }); };
let commitT = 0; const commitSoon = () => { clearTimeout(commitT); commitT = setTimeout(commit, 400); };
function place(el, w) { el.style.left = w.x + '%'; el.style.top = w.y + '%'; el.style.setProperty('--ws', w.s); }
function fit(el, w) {
  const zr = $('#zone').getBoundingClientRect(), r = el.getBoundingClientRect(); if (!zr.width) return;
  w.x = clamp(w.x, 0, Math.max(0, 100 - r.width / zr.width * 100)); w.y = clamp(w.y, 0, Math.max(0, 100 - r.height / zr.height * 100)); place(el, w);
}
function widgetBody(w) {
  if (w.type === 'clock') return '<div class="w-greet"></div><div class="w-clock"></div><div class="w-date"></div>';
  if (w.type === 'weather') return '<div class="glass widget wxb" data-f tabindex="0"></div>';
  if (w.type === 'calendar') return '<div class="glass cal"></div>';
  if (w.type === 'note') return `<div class="glass note"><textarea data-f spellcheck="false" placeholder="${esc(T('notePh'))}">${esc(w.text || '')}</textarea></div>`;
  if (w.type === 'world') return `<div class="glass wrl"><div class="wl-c">${esc(w.city || '')}</div><div class="wl-t" data-tz="${esc(w.tz || '')}"></div></div>`;
  return '';
}
function renderZone() {
  const z = $('#zone'); z.innerHTML = '';
  for (const w of widgets()) {
    const el = document.createElement('div');
    el.className = 'wd wd-' + w.type; el.dataset.wid = w.id; place(el, w);
    el.innerHTML = widgetBody(w) + '<button class="wd-x" tabindex="-1" aria-label="×">×</button><i class="wd-rs"></i>';
    if (editing) { el.tabIndex = 0; $$('textarea', el).forEach(t => { t.tabIndex = -1; }); }
    const ta = $('textarea', el); if (ta) ta.oninput = () => { w.text = ta.value; commitSoon(); };
    const wx = $('.wxb', el); if (wx) wx.onclick = () => { if (!editing) settings('general'); };
    z.append(el);
  }
  calKey = ''; tick(); paintWx();
}
function calendar() {
  const d = new Date(), key = d.toDateString() + cfg.lang; if (key === calKey) return; calKey = key;
  let first = 1; try { const l = new Intl.Locale(cfg.lang); first = (l.getWeekInfo ? l.getWeekInfo() : l.weekInfo)?.firstDay || 1; } catch {}
  const y = d.getFullYear(), m = d.getMonth(), lead = (new Date(y, m, 1).getDay() + 7 - (first % 7)) % 7, days = new Date(y, m + 1, 0).getDate();
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + ((first % 7) + i) % 7).toLocaleDateString(cfg.lang, { weekday: 'narrow' }));
  const html = `<h4>${esc(d.toLocaleDateString(cfg.lang, { month: 'long', year: 'numeric' }))}</h4><div class="g">${names.map(n => `<b>${esc(n)}</b>`).join('')}${'<span></span>'.repeat(lead)}${[...Array(days)].map((_, i) => `<span class="${i + 1 === d.getDate() ? 'today' : ''}">${i + 1}</span>`).join('')}</div>`;
  $$('.cal').forEach(e => { e.innerHTML = html; });
}

/* ---------- Begrüßung, Uhr, Wetter ---------- */
function tick() {
  const d = new Date(), h = d.getHours();
  $$('.w-greet').forEach(e => { e.textContent = T(h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 22 ? 'evening' : 'night'); });
  $$('.w-clock').forEach(e => { e.textContent = d.toLocaleTimeString(cfg.lang, { hour: '2-digit', minute: '2-digit', hour12: !cfg.h24 }); });
  $$('.w-date').forEach(e => { e.textContent = d.toLocaleDateString(cfg.lang, { weekday: 'long', day: 'numeric', month: 'long' }); });
  $$('.wl-t').forEach(e => { try { e.textContent = d.toLocaleTimeString(cfg.lang, { hour: '2-digit', minute: '2-digit', hour12: !cfg.h24, timeZone: e.dataset.tz || undefined }); } catch { e.textContent = '–'; } });
  calendar();
}
const paintWx = () => $$('.wxb').forEach(e => { e.innerHTML = wxHtml; });
const wmo = c => c === 0 ? ['wx0', '☀️'] : c <= 2 ? ['wx1', '⛅'] : c === 3 ? ['wx2', '☁️'] : c <= 48 ? ['wx3', '🌫️'] : c <= 57 ? ['wx4', '🌦️']
  : c <= 67 ? ['wx5', '🌧️'] : c <= 77 ? ['wx6', '🌨️'] : c <= 82 ? ['wx7', '🌦️'] : c <= 86 ? ['wx6', '🌨️'] : ['wx8', '⛈️'];
async function weather() {
  if (cfg.lat == null) { wxHtml = `<div><div class="ws" style="margin:0">☁️</div><div class="ws">${esc(T('city'))}</div></div>`; paintWx(); return; }
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1${cfg.fahr ? '&temperature_unit=fahrenheit' : ''}`;
    const r = await (await fetch(u)).json(), [k, i] = wmo(r.current.weather_code), R = Math.round;
    wxHtml = `<div class="wi">${i}</div><div><div class="wt">${R(r.current.temperature_2m)}°</div><div class="ws">${esc(cfg.city)}</div><div class="ws">${esc(T(k))}, ${R(r.daily.temperature_2m_max[0])}° / ${R(r.daily.temperature_2m_min[0])}°</div></div>`;
  } catch { wxHtml = '<div class="ws">–</div>'; }
  paintWx();
}

/* ---------- Layout bearbeiten ---------- */
function enterEdit() {
  closeModal(); editing = true; document.body.classList.add('editing'); $('#editbar').hidden = false;
  $$('.wd').forEach(e => { e.tabIndex = 0; }); $$('.wd textarea').forEach(t => { t.tabIndex = -1; });
  ($('.wd') || $('#eDone')).focus();
}
async function exitEdit() {
  editing = false; document.body.classList.remove('editing'); $('#editbar').hidden = true;
  $$('.wd').forEach(e => e.removeAttribute('tabindex')); $$('.wd textarea').forEach(t => { t.tabIndex = 0; });
  await commit(); $('.tile')?.focus();
}
async function removeWidget(id) { cfg.widgets = widgets().filter(w => w.id !== id); await commit(); renderZone(); ($('.wd') || $('#eAdd')).focus(); }
async function addWidget(w) {
  const n = widgets().length; Object.assign(w, { id: w.type + '-' + Date.now().toString(36), x: 34 + (n * 9) % 40, y: 6 + (n * 8) % 30, s: 1 });
  cfg.widgets = [...widgets(), w]; await commit(); renderZone(); closeModal();
  const el = $(`.wd[data-wid="${w.id}"]`); if (el) { fit(el, w); commitSoon(); }
  if (editing) el?.focus(); else enterEdit();
}
function addWidgetModal() {
  const have = new Set(widgets().map(w => w.type));
  const opts = [['calendar', 'wCal'], ['note', 'wNote'], ['world', 'wWorld'], ['clock', 'wClock'], ['weather', 'wWeather']].filter(([t]) => ['calendar', 'note', 'world'].includes(t) || !have.has(t));
  const m = modal('addw', `<h2>${esc(T('addWidget'))}</h2><div class="stack">${opts.map(([t, k]) => `<button class="btn" data-f data-wt="${t}">${esc(T(k))}</button>`).join('')}<button class="btn" data-f id="wx">${esc(T('cancel'))}</button></div>`);
  $$('[data-wt]', m).forEach(b => b.onclick = () => b.dataset.wt === 'world' ? worldForm() : addWidget({ type: b.dataset.wt }));
  $('#wx', m).onclick = () => { closeModal(); if (editing) $('.wd')?.focus(); };
}
function worldForm() {
  const m = modal('world', `<h2>${esc(T('wWorld'))}</h2><label>${esc(T('wCity'))}</label><input type="text" data-f id="wc" placeholder="Tokyo"><div class="hint" id="wm"></div>
    <div class="actions"><button class="btn" data-f id="wback">${esc(T('back'))}</button><button class="btn primary" data-f id="wok">${esc(T('apply'))}</button></div>`);
  $('#wc', m).focus(); $('#wback', m).onclick = addWidgetModal;
  $('#wok', m).onclick = async () => {
    const q = $('#wc', m).value.trim(), msg = $('#wm', m); if (!q) return; msg.textContent = '…';
    try {
      const r = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${cfg.lang}`)).json()).results?.[0];
      if (!r || !r.timezone) { msg.textContent = T('cityNf'); return; }
      addWidget({ type: 'world', city: r.name, tz: r.timezone });
    } catch { msg.textContent = '–'; }
  };
}
let drag = null;
$('#zone').addEventListener('pointerdown', e => {
  if (!editing) return;
  const el = e.target.closest('.wd'); if (!el) return;
  const w = wById(el.dataset.wid); if (!w) return;
  if (e.target.closest('.wd-x')) { e.preventDefault(); removeWidget(w.id); return; }
  if (!cfg.widgets) cfg.widgets = defaultWidgets();
  const w2 = wById(el.dataset.wid);
  drag = { el, w: w2, rs: !!e.target.closest('.wd-rs'), sx: e.clientX, sy: e.clientY, x0: w2.x, y0: w2.y, s0: w2.s, zr: $('#zone').getBoundingClientRect(), r0: el.getBoundingClientRect() };
  el.setPointerCapture(e.pointerId); el.focus(); e.preventDefault();
});
$('#zone').addEventListener('pointermove', e => {
  if (!drag) return; const d = drag, dx = e.clientX - d.sx, dy = e.clientY - d.sy;
  if (d.rs) d.w.s = +clamp(d.s0 * (1 + (dx / d.r0.width + dy / d.r0.height) / 2), .4, 3.5).toFixed(3);
  else { d.w.x = d.x0 + dx / d.zr.width * 100; d.w.y = d.y0 + dy / d.zr.height * 100; }
  place(d.el, d.w); fit(d.el, d.w);
});
const endDrag = () => { if (drag) { drag = null; commit(); } };
$('#zone').addEventListener('pointerup', endDrag); $('#zone').addEventListener('pointercancel', endDrag);
$('#eAdd').onclick = addWidgetModal; $('#eDone').onclick = exitEdit;
$('#eReset').onclick = async () => { cfg.widgets = null; await save({ widgets: null }); renderZone(); $('.wd')?.focus(); };
/* Tastatur im Bearbeitungsmodus: Pfeile verschieben, Umschalt + Pfeile skalieren, Entf entfernt */
function editKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); exitEdit(); return true; }
  const el = e.target.closest?.('.wd'); if (!el) return false;
  if (!cfg.widgets) cfg.widgets = defaultWidgets();
  const w = wById(el.dataset.wid); if (!w) return false;
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    if (e.shiftKey) w.s = +clamp(w.s * (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1.05 : 1 / 1.05), .4, 3.5).toFixed(3);
    else { const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; w.x += v[0]; w.y += v[1]; }
    place(el, w); fit(el, w); commitSoon(); return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeWidget(w.id); return true; }
  if (e.key === 'Enter') { e.preventDefault(); exitEdit(); return true; }
  return false;
}

/* ---------- Kacheln ---------- */
function render() {
  const row = $('#row'); row.innerHTML = '';
  $('#empty').hidden = cfg.apps.length > 0;
  for (const a of cfg.apps) {
    const t = document.createElement('button');
    t.className = 'tile'; t.dataset.f = 1; t.dataset.id = a.id; t.style.setProperty('--c', colorOf(a));
    t.innerHTML = `<div class="card">${a.icon ? `<img src="${a.icon}" alt="">` : `<span class="mono">${esc((a.name[0] || '?').toUpperCase())}</span>`}</div><div class="name">${esc(a.name)}</div>`;
    t.onclick = () => { blip(700); api.launch(a.id); };
    t.oncontextmenu = e => { e.preventDefault(); options(a); };
    row.append(t);
  }
  const add = document.createElement('button');
  add.className = 'tile add'; add.dataset.f = 1;
  add.innerHTML = `<div class="card">+</div><div class="name">${esc(T('add'))}</div>`;
  add.onclick = () => form(); row.append(add);
}
function pill() { $('#pill').hidden = cfg.paired > 0; }
function blip(f = 520) {
  if (!cfg.sounds) return;
  try {
    AC = AC || new AudioContext(); const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.value = .035; o.connect(g); g.connect(AC.destination);
    g.gain.setTargetAtTime(0, AC.currentTime + .03, .02); o.start(); o.stop(AC.currentTime + .1);
  } catch {}
}

/* ---------- Dialoge ---------- */
function modal(id, html, cls = '') {
  if (modalEl && modalId === id) { const s = $('.sheet', modalEl); s.innerHTML = html; s.className = 'sheet glass ' + cls; $('[data-f]:not([hidden])', modalEl)?.focus(); return modalEl; }
  closeModal(); prevFocus = document.activeElement; modalId = id;
  const m = modalEl = document.createElement('div');
  m.className = 'modal'; m.innerHTML = `<div class="sheet glass ${cls}">${html}</div>`;
  document.body.append(m);
  m.addEventListener('mousedown', e => { if (e.target === m && id !== 'welcome') closeModal(); });
  requestAnimationFrame(() => { m.classList.add('open'); $('[data-f]:not([hidden])', m)?.focus(); });
  return m;
}
function closeModal() {
  if (!modalEl) return;
  const m = modalEl; modalEl = null; modalId = null; m.classList.remove('open'); setTimeout(() => m.remove(), 250);
  if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
}
const save = async d => { Object.assign(cfg, d); await api.setConfig(d); };
const themeSeg = () => ['system', 'dark', 'light'].map(v => `<button class="btn ${cfg.theme === v ? 'on' : ''}" data-f data-theme="${v}">${esc(T({ system: 'tSys', dark: 'tDark', light: 'tLight' }[v]))}</button>`).join('');
const swatches = () => ACCENTS.map(c => `<button class="sw ${cfg.accent === c ? 'on' : ''}" data-f data-acc="${c}" style="--s:${c}" aria-label="${c}"></button>`).join('');
const langChips = () => I18N.langs.map(l => `<button class="btn ${cfg.lang === l.code ? 'on' : ''}" data-f data-lang="${l.code}" lang="${l.code}">${l.name}</button>`).join('');
function bindLook(m, rerender) {
  $$('[data-theme]', m).forEach(b => b.onclick = async () => { await save({ theme: b.dataset.theme }); applyTheme(); rerender(); });
  $$('[data-acc]', m).forEach(b => b.onclick = async () => { await save({ accent: b.dataset.acc }); applyTheme(); rerender(); });
  $$('[data-lang]', m).forEach(b => b.onclick = async () => { await save({ lang: b.dataset.lang }); applyLang(); rerender(); });
}
const refocus = sel => requestAnimationFrame(() => $(sel, modalEl)?.focus());

/* ---------- Willkommen ---------- */
function welcome(step = 0) {
  const dots = `<div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = (back, label = T('next')) => `<div class="actions">${back ? `<button class="btn" data-f id="wb">${esc(T('back'))}</button>` : ''}<button class="btn primary" data-f id="wn">${esc(label)}</button></div>`;
  let h;
  if (step === 0) h = `${dots}<h1>${esc(T('welcome'))}</h1><p class="sub">${esc(T('wSub'))}</p><div class="chips">${langChips()}</div>${nav(false)}`;
  if (step === 1) h = `${dots}<h2>${esc(T('device'))}</h2><input type="text" data-f id="dn" value="${esc(cfg.deviceName || '')}" maxlength="40"><div class="hint">${esc(T('devHint'))}</div>${nav(true)}`;
  if (step === 2) h = `${dots}<h2>${esc(T('appearance'))}</h2><label>${esc(T('theme'))}</label><div class="seg">${themeSeg()}</div><label>${esc(T('accent'))}</label><div class="swatches">${swatches()}</div>${nav(true)}`;
  if (step === 3) h = `${dots}<div class="check"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h1>${esc(T('done'))}</h1><p class="sub">${esc(cfg.deviceName)}</p>${nav(true, T('start'))}`;
  const m = modal('welcome', h, 'wide');
  bindLook(m, () => welcome(step));
  if (step === 0) refocus('#wn');
  $('#wb', m) && ($('#wb', m).onclick = () => welcome(step - 1));
  $('#wn', m).onclick = async () => {
    if (step === 1) await save({ deviceName: $('#dn', m).value.trim() || cfg.deviceName });
    if (step === 3) { await save({ onboarded: true }); applyLang(); closeModal(); $('.tile')?.focus(); return; }
    welcome(step + 1);
  };
}

/* ---------- Kachel-Menü und Formular ---------- */
function options(a) {
  const i = cfg.apps.findIndex(x => x.id === a.id);
  const m = modal('options', `<h2>${esc(a.name)}</h2><div class="stack">
    <button class="btn primary" data-f id="o-open">${esc(T('open'))}</button>
    <button class="btn" data-f id="o-edit">${esc(T('edit'))}</button>
    ${i > 0 ? `<button class="btn" data-f id="o-l">← ${esc(T('moveL'))}</button>` : ''}
    ${i < cfg.apps.length - 1 ? `<button class="btn" data-f id="o-r">${esc(T('moveR'))} →</button>` : ''}
    <button class="btn danger" data-f id="o-del">${esc(T('remove'))}</button>
    <button class="btn" data-f id="o-x">${esc(T('close'))}</button></div>`);
  $('#o-open', m).onclick = () => { closeModal(); api.launch(a.id); };
  $('#o-edit', m).onclick = () => form(a);
  if ($('#o-l', m)) $('#o-l', m).onclick = async () => { await api.moveApp(a.id, -1); closeModal(); };
  if ($('#o-r', m)) $('#o-r', m).onclick = async () => { await api.moveApp(a.id, 1); closeModal(); };
  let sure = false;
  $('#o-del', m).onclick = e => { if (!sure) { sure = true; e.target.textContent = T('sure'); } else { closeModal(); api.removeApp(a.id); } };
  $('#o-x', m).onclick = closeModal;
}
function form(edit) {
  const S = { type: edit ? edit.type : 'web', icon: edit ? 'keep' : 'auto', iconPath: null, engine: edit?.engine || 'auto', exe: edit && edit.type === 'exe' ? edit.target : '', touched: !!edit };
  const m = modal('form', `<h2>${esc(T(edit ? 'editT' : 'addT'))}</h2>
    <div class="seg" ${edit ? 'hidden' : ''}><button class="btn" data-f data-type="web">${esc(T('web'))}</button><button class="btn" data-f data-type="exe">${esc(T('prog'))}</button></div>
    <div id="fw"><label>${esc(T('addr'))}</label><input type="text" data-f id="url" placeholder="netflix.com" value="${edit && edit.type === 'web' ? esc(edit.target) : ''}"></div>
    <div id="fe"><label>${esc(T('prog'))}</label><div class="line"><button class="btn" data-f id="pick">${esc(T('pick'))}</button><span class="hint" id="exeName"></span></div></div>
    <div id="fb"><label>${esc(T('browser'))}</label><div class="seg"><button class="btn" data-f data-eng="auto">${esc(T('auto'))}</button><button class="btn" data-f data-eng="builtin">${esc(T('bBuilt'))}</button><button class="btn" data-f data-eng="edge">${esc(T('bEdge'))}</button></div></div>
    <label>${esc(T('name'))}</label><input type="text" data-f id="name" value="${edit ? esc(edit.name) : ''}">
    <label>${esc(T('image'))}</label>
    <div class="seg"><button class="btn" data-f data-icon="${edit ? 'keep' : 'auto'}">${esc(T(edit ? 'keep' : 'auto'))}</button><button class="btn" data-f data-icon="file">${esc(T('own'))}</button></div>
    <div class="actions"><button class="btn" data-f id="cancel">${esc(T('cancel'))}</button><button class="btn primary" data-f id="ok">${esc(T('save'))}</button></div>`);
  const nm = $('#name', m);
  const sync = () => {
    $$('[data-type]', m).forEach(b => b.classList.toggle('on', b.dataset.type === S.type));
    $('#fw', m).hidden = S.type !== 'web'; $('#fb', m).hidden = S.type !== 'web'; $('#fe', m).hidden = S.type !== 'exe';
    $$('[data-eng]', m).forEach(b => b.classList.toggle('on', b.dataset.eng === S.engine));
    $$('[data-icon]', m).forEach(b => b.classList.toggle('on', b.dataset.icon === S.icon));
    $('#exeName', m).textContent = S.exe ? S.exe.split(/[\\/]/).pop() : '';
  };
  const guess = t => { if (!S.touched) nm.value = t; };
  nm.oninput = () => { S.touched = true; };
  $$('[data-type]', m).forEach(b => b.onclick = () => { S.type = b.dataset.type; sync(); });
  $$('[data-eng]', m).forEach(b => b.onclick = () => { S.engine = b.dataset.eng; sync(); });
  $('#url', m).oninput = e => {
    try { const v = e.target.value; guess(new URL(/^https?:/i.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, '').split('.')[0].replace(/^./, c => c.toUpperCase())); } catch {}
  };
  $('#pick', m).onclick = async () => { const p = await api.pickExe(); if (p) { S.exe = p; guess(p.split(/[\\/]/).pop().replace(/\.(exe|app)$/i, '')); sync(); } };
  $$('[data-icon]', m).forEach(b => b.onclick = async () => {
    if (b.dataset.icon === 'file') { const p = await api.pickImage(); if (p) { S.icon = 'file'; S.iconPath = p; } } else S.icon = b.dataset.icon;
    sync();
  });
  $('#cancel', m).onclick = closeModal;
  $('#ok', m).onclick = async () => {
    const target = S.type === 'web' ? $('#url', m).value.trim() : S.exe;
    if (!target) { (S.type === 'web' ? $('#url', m) : $('#pick', m)).focus(); return; }
    const ok = $('#ok', m); ok.disabled = true; ok.textContent = T('loading');
    await api.saveApp({ id: edit?.id, type: S.type, name: nm.value, target, engine: S.engine, iconMode: S.icon, iconPath: S.iconPath });
    closeModal();
  };
  sync();
}

/* ---------- Einstellungen ---------- */
const FS = [.85, 1, 1.15, 1.3, 1.5, 1.75];
const tog = (b, label, get, set) => {
  const u = () => { b.textContent = `${label}: ${get() ? '✓' : '–'}`; b.classList.toggle('on', get()); };
  b.onclick = async () => { await set(!get()); u(); }; u();
};
function settings(tab = 'appearance') {
  const tabs = ['appearance', 'general', 'layout', 'remote', 'power'];
  let body = '';
  if (tab === 'appearance') body = `<label>${esc(T('theme'))}</label><div class="seg">${themeSeg()}</div>
    <label>${esc(T('accent'))}</label><div class="swatches">${swatches()}</div>
    <label>${esc(T('lang'))}</label><div class="chips">${langChips()}</div>
    <label>${esc(T('wall'))}</label><div class="seg"><button class="btn" data-f id="wp">${esc(T('wallAdd'))}</button>${cfg.walls?.length ? `<button class="btn" data-f id="wc">${esc(T('wallDel'))}</button>` : ''}<button class="btn" data-f id="sl"></button><button class="btn" data-f id="dw"></button><button class="btn" data-f id="calm"></button></div>
    <label>${esc(T('fontSize'))}</label><div class="seg">${FS.map(v => `<button class="btn ${Math.abs((cfg.fontScale || 1) - v) < .01 ? 'on' : ''}" data-f data-fs="${v}">${Math.round(v * 100)}%</button>`).join('')}</div>`;
  if (tab === 'layout') body = `<div class="hint">${esc(T('layoutHint'))}</div><div class="seg" style="margin-top:1.2rem"><button class="btn primary" data-f id="le">${esc(T('editLayout'))}</button><button class="btn" data-f id="la">${esc(T('addWidget'))}</button><button class="btn" data-f id="lr">${esc(T('resetLayout'))}</button></div>`;
  if (tab === 'general') body = `<label>${esc(T('device'))}</label><input type="text" data-f id="dn" value="${esc(cfg.deviceName || '')}" maxlength="40">
    <label>${esc(T('city'))}</label><div class="line"><input type="text" data-f id="city" value="${esc(cfg.city || '')}"><button class="btn" data-f id="saveCity">${esc(T('apply'))}</button></div><div class="hint" id="cityMsg"></div>
    <label>${esc(T('general'))}</label><div class="seg"><button class="btn" data-f id="auto"></button><button class="btn" data-f id="escc"></button><button class="btn" data-f id="snd"></button><button class="btn" data-f id="h24"></button><button class="btn" data-f id="fh"></button></div>`;
  if (tab === 'remote') body = `<div class="remote"><img id="qr" alt="QR"><div><div class="hint" style="margin:0">${esc(T('remoteHint'))}</div><div id="pin"></div><div class="hint" id="rurl"></div><div class="hint" id="paired"></div></div></div>
    <div class="actions" style="justify-content:flex-start"><button class="btn" data-f id="unpair">${esc(T('unpair'))}</button></div>`;
  if (tab === 'power') body = `<div class="seg" style="margin-top:1.2rem"><button class="btn" data-f data-pw="sleep">${esc(T('sleep'))}</button><button class="btn" data-f data-pw="restart">${esc(T('restart'))}</button><button class="btn danger" data-f data-pw="shutdown">${esc(T('shutdown'))}</button></div>
    <div class="actions" style="justify-content:flex-start"><button class="btn danger" data-f id="quit">${esc(T('quit'))}</button></div>`;
  const m = modal('settings', `<h2>${esc(T('settings'))}</h2><div class="seg tabs">${tabs.map(t => `<button class="btn ${t === tab ? 'on' : ''}" data-f data-tab="${t}">${esc(T(t))}</button>`).join('')}</div>${body}
    <div class="actions"><button class="btn primary" data-f id="done">${esc(T('done'))}</button></div>`, 'wide');
  $$('[data-tab]', m).forEach(b => b.onclick = () => settings(b.dataset.tab));
  $('#done', m).onclick = closeModal;
  if (tab === 'appearance') {
    bindLook(m, () => settings('appearance'));
    $('#wp', m).onclick = async () => { cfg.walls = await api.wallPick(); wallStart(); settings('appearance'); };
    if ($('#wc', m)) $('#wc', m).onclick = async () => { cfg.walls = await api.wallClear(); wallStart(); settings('appearance'); };
    tog($('#sl', m), T('slide'), () => cfg.slide, async v => { await save({ slide: v }); wallStart(); });
    tog($('#dw', m), T('defWalls'), () => cfg.wallDefaults !== false, async v => { await save({ wallDefaults: v }); wallStart(); });
    tog($('#calm', m), T('calm'), () => cfg.calm, async v => { await save({ calm: v }); applyTheme(); });
    $$('[data-fs]', m).forEach(b => b.onclick = async () => { await save({ fontScale: +b.dataset.fs }); applyTheme(); settings('appearance'); refocus(`[data-fs="${b.dataset.fs}"]`); });
  }
  if (tab === 'layout') {
    $('#le', m).onclick = enterEdit; $('#la', m).onclick = addWidgetModal;
    $('#lr', m).onclick = async () => { await save({ widgets: null }); renderZone(); closeModal(); };
  }
  if (tab === 'general') {
    $('#dn', m).onchange = async e => { await save({ deviceName: e.target.value.trim() || cfg.deviceName }); applyLang(); };
    $('#saveCity', m).onclick = async () => {
      const q = $('#city', m).value.trim(), msg = $('#cityMsg', m); if (!q) return; msg.textContent = '…';
      try {
        const r = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${cfg.lang}`)).json()).results?.[0];
        if (!r) { msg.textContent = T('cityNf'); return; }
        await save({ city: r.name, lat: r.latitude, lon: r.longitude }); msg.textContent = `${T('saved')}: ${r.name}${r.country ? ', ' + r.country : ''}`; weather();
      } catch { msg.textContent = '–'; }
    };
    tog($('#auto', m), T('autostart'), () => cfg.autostart, async v => { cfg.autostart = v; await api.setConfig({ autostart: v }); });
    tog($('#escc', m), T('dblEsc'), () => cfg.escClose, v => save({ escClose: v }));
    tog($('#snd', m), T('sounds'), () => cfg.sounds, async v => { await save({ sounds: v }); blip(); });
    tog($('#h24', m), T('h24'), () => cfg.h24, async v => { await save({ h24: v }); tick(); });
    tog($('#fh', m), T('fahr'), () => cfg.fahr, async v => { await save({ fahr: v }); weather(); });
  }
  if (tab === 'remote') { $('#unpair', m).onclick = () => api.unpair(); refreshRemote(); }
  if (tab === 'power') {
    $$('[data-pw]', m).forEach(b => { let armed = 0, label = b.textContent; b.onclick = () => {
      if (!armed) { armed = 1; b.textContent = T('confirm'); setTimeout(() => { armed = 0; b.textContent = label; }, 3000); } else api.power(b.dataset.pw); }; });
    $('#quit', m).onclick = () => api.quit();
  }
}
async function refreshRemote() {
  if (modalId !== 'settings' || !$('#pin')) return;
  const i = await api.remoteInfo();
  $('#qr').src = i.qr; $('#pin').textContent = i.pin; $('#rurl').textContent = i.url; $('#paired').textContent = `${T('pairedN')}: ${i.paired}`;
}

/* ---------- Navigation (Pfeiltasten / Fernbedienung) ---------- */
function move(dir) {
  const root = modalEl || document.body;
  const list = $$('[data-f]', root).filter(e => !e.disabled && e.getClientRects().length && (modalEl || !e.closest('.modal')));
  const cur = document.activeElement;
  if (!list.includes(cur)) { list[0]?.focus(); return; }
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best, bs = 1e9;
  for (const e of list) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect(), dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
    const along = dir === 'Left' ? -dx : dir === 'Right' ? dx : dir === 'Up' ? -dy : dy, side = dir === 'Left' || dir === 'Right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 2) continue; const s = along + side * 3; if (s < bs) { bs = s; best = e; }
  }
  best?.focus();
}
addEventListener('keydown', e => {
  if (editing && !modalEl && editKey(e)) return;
  const inArea = e.target.tagName === 'TEXTAREA';
  if (inArea) {
    const t = e.target, up = e.key === 'ArrowUp' && t.selectionStart === 0, down = e.key === 'ArrowDown' && t.selectionEnd === t.value.length;
    if (!(up || down) && e.key !== 'Escape') return;
    if (e.key === 'Escape') { t.blur(); return; }
  }
  const inInput = e.target.tagName === 'INPUT';
  if (e.key === 'Escape') { if (modalEl && modalId !== 'welcome') { e.preventDefault(); closeModal(); } return; }
  if (e.key.startsWith('Arrow')) {
    if (inInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault(); move(e.key.slice(5));
  } else if (e.key === 'Enter') {
    e.preventDefault(); inInput ? move('Down') : e.target.dataset?.f && e.target.click();
  } else if ((e.key === 'ContextMenu' || e.key === 'Delete') && !modalEl && e.target.dataset?.id) {
    e.preventDefault(); options(cfg.apps.find(a => a.id === e.target.dataset.id));
  }
});
document.addEventListener('focusin', e => {
  if (e.target.dataset?.f) blip(480);
  const t = e.target.closest?.('.tile'); if (!t) return;
  const a = cfg.apps.find(x => x.id === t.dataset.id);
  a ? setBg(colorOf(a)) : setBg(...idleBg());
  t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
});
$('#row').addEventListener('mouseover', e => { const t = e.target.closest('.tile'); if (t && document.activeElement !== t && !modalEl && !editing) t.focus({ preventScroll: true }); });

/* ---------- Maus: Glanz, Neigung und Tiefe der Kacheln folgen dem Zeiger ---------- */
let mx = -1e4, my = -1e4, raf = 0, idleT;
function parallax() {
  raf = 0; const rs = document.documentElement.style; rs.setProperty('--mx', mx + 'px'); rs.setProperty('--my', my + 'px');
  for (const c of $$('.tile .card')) {
    const b = c.getBoundingClientRect(), dx = (mx - (b.left + b.width / 2)) / b.width, dy = (my - (b.top + b.height / 2)) / b.height, k = Math.max(0, 1 - Math.hypot(dx, dy) / 3.2);
    c.style.setProperty('--rx', (-dy * 10 * k).toFixed(2) + 'deg'); c.style.setProperty('--ry', (dx * 12 * k).toFixed(2) + 'deg');
    c.style.setProperty('--ix', (dx * 14 * k).toFixed(1) + 'px'); c.style.setProperty('--iy', (dy * 10 * k).toFixed(1) + 'px');
    c.style.setProperty('--hx', (50 + dx * 45).toFixed(0) + '%'); c.style.setProperty('--hy', (50 + dy * 45).toFixed(0) + '%');
  }
}
const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle'), 3000); };
addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; wake(); if (!raf) raf = requestAnimationFrame(parallax); });
document.addEventListener('mouseleave', () => { mx = my = -1e4; if (!raf) raf = requestAnimationFrame(parallax); });
wake();

/* ---------- Start ---------- */
api.on('apps', list => {
  const old = new Set(cfg.apps.map(a => a.id)), fid = document.activeElement?.dataset?.id;
  cfg.apps = list; render();
  const nw = list.find(a => !old.has(a.id)), target = nw ? nw.id : fid;
  ($(`.tile[data-id="${target}"]`) || $('.tile'))?.focus();
});
api.on('remote', d => { cfg.paired = d.paired; pill(); refreshRemote(); });
$('#gear').onclick = () => settings(); $('#pill').onclick = () => settings('remote');
(async () => {
  cfg = await api.config();
  applyTheme(); applyLang(); wallStart(); setInterval(tick, 1000); setInterval(weather, 9e5);
  $('.tile')?.focus();
  if (!cfg.onboarded) welcome(0);
})();
